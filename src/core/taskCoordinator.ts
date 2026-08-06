/* [028A-18] Coordinador universal de tareas para Sentinel.
 * La unidad de paralelismo es una tarea por rama/worktree. El estado efímero
 * vive junto al Git común y los worktrees temporales dentro de la raíz del
 * repositorio, nunca fuera del checkout del consumidor. */
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeAtomic } from './atomicFile';
import { assertSafeBranch } from './branchValidation';

const execFileAsync = promisify(execFile);
export const TASK_COORDINATOR_SCHEMA_VERSION = 1;
export const TASK_TTL_MS = 6 * 60 * 60 * 1000;
const OPERATION_LOCK_TTL_MS = 30 * 60 * 1000;
const LOCK_REFRESH_MS = 60 * 1000;

export type TaskState = 'CLAIMED' | 'ACTIVE' | 'INTEGRATING' | 'INTEGRATED';

export interface TaskRecord {
  schemaVersion: 1;
  taskId: string;
  agent: string;
  state: TaskState;
  branch: string | null;
  worktree: string | null;
  base: string | null;
  baseHead: string | null;
  target: string;
  head: string | null;
  createdAt: string;
  updatedAt: string;
  updatedAtMs: number;
  pid: number;
  host: string;
}

export interface TaskCoordinatorOptions {
  projectRoot: string;
  agent: string;
  taskId: string;
  now?: number;
  worktreePath?: string;
  base?: string;
  target?: string;
  /** Rama principal declarada por el consumidor; nunca se infiere como `main`. */
  primaryBranch?: string;
  force?: boolean;
}

export interface TaskStatusResult {
  tasks: TaskRecord[];
  invalidMetadata: string[];
  orphanWorktrees: string[];
  orphanBranches: string[];
  expiredLocks: string[];
}

const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_AGENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_LOCK_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
export function sanitizeBranch(value: string): string {
  return assertSafeBranch(value);
}

function requiredPrimaryBranch(options: Pick<TaskCoordinatorOptions, 'primaryBranch' | 'target'>): string {
  if (options.primaryBranch && options.target
    && sanitizeBranch(options.primaryBranch) !== sanitizeBranch(options.target)) {
    throw new Error(`target ${options.target} no coincide con primaryBranch ${options.primaryBranch}`);
  }
  const value = options.primaryBranch ?? options.target;
  if (!value) throw new Error('falta declarar la rama principal del proyecto (primaryBranch)');
  return sanitizeBranch(value);
}

export function sanitizeTaskId(value: string): string {
  if (!SAFE_TASK_ID.test(value)) throw new Error(`task-id inválido: ${value}`);
  return value;
}

export function sanitizeAgent(value: string): string {
  if (!SAFE_AGENT.test(value)) throw new Error(`agent inválido: ${value}`);
  return value;
}

function rootOf(value: string): string { return path.resolve(value); }

async function git(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function gitStatus(root: string): Promise<string> {
  /* `.sentinel/` is Sentinel-owned runtime state. It must not make a clean
   * consumer checkout look dirty, even when the consumer has no .gitignore. */
  const output = await git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  return output.split(/\r?\n/u)
    .filter(line => {
      const file = line.slice(3).replace(/^"|"$/gu, '');
      return file !== '.sentinel' && !file.startsWith('.sentinel/');
    })
    .join('\n');
}

async function gitCommonDir(root: string): Promise<string> {
  return path.resolve(root, await git(root, ['rev-parse', '--git-common-dir']));
}

async function gitTopLevel(root: string): Promise<string> {
  return path.resolve(root, await git(root, ['rev-parse', '--show-toplevel']));
}

async function canonicalPath(target: string): Promise<string> {
  let candidate = path.resolve(target);
  const missing: string[] = [];
  while (true) {
    try {
      const existing = await fs.realpath(candidate);
      return path.resolve(existing, ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      missing.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

function isStrictlyInside(candidate: string, boundary: string): boolean {
  const relative = path.relative(boundary, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function repositoryRoot(root: string, commonDir: string): Promise<string> {
  /* A linked worktree reports its own top level, while --git-common-dir still
   * points at the main repository's .git. Prefer that common root when it is
   * available; submodules keep their own top-level fallback. */
  const topLevel = await gitTopLevel(root);
  const commonRoot = path.basename(commonDir).toLowerCase() === '.git'
    ? path.dirname(commonDir)
    : topLevel;
  const canonicalRoot = await canonicalPath(commonRoot);
  const canonicalTopLevel = await canonicalPath(topLevel);
  if (!isStrictlyInside(canonicalTopLevel, canonicalRoot) && canonicalTopLevel !== canonicalRoot) {
    throw new Error(`el checkout ${topLevel} está fuera de la raíz del repositorio ${canonicalRoot}`);
  }
  return canonicalRoot;
}

function projectIdentity(commonDir: string, primaryBranch: string): string {
  return crypto.createHash('sha256')
    .update(`${commonDir}\0${assertSafeBranch(primaryBranch)}`)
    .digest('hex')
    .slice(0, 16);
}

function taskBranchPrefix(identity: string): string {
  return `task/${identity}`;
}

async function coordinatorDir(root: string, primaryBranch: string): Promise<string> {
  const commonDir = await gitCommonDir(root);
  const repositoryRootPath = await repositoryRoot(root, commonDir);
  return path.join(repositoryRootPath, '.sentinel', 'coordination', projectIdentity(commonDir, primaryBranch));
}

async function taskFilePath(root: string, taskId: string, primaryBranch: string): Promise<string> {
  return path.join(await coordinatorDir(root, primaryBranch), `${sanitizeTaskId(taskId)}.json`);
}

async function lockPath(root: string, key: string, primaryBranch: string): Promise<string> {
  if (!SAFE_LOCK_KEY.test(key)) throw new Error(`clave de lock inválida: ${key}`);
  return path.join(await coordinatorDir(root, primaryBranch), `${key}.lock`);
}

async function acquireLock(lock: string, key: string): Promise<string> {
  await fs.mkdir(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await fs.mkdir(lock);
      const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
      await fs.writeFile(path.join(lock, 'owner.json'), `${JSON.stringify({ token, pid: process.pid, host: os.hostname(), at: new Date().toISOString() })}\n`, 'utf8');
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let info;
      try {
        info = await fs.stat(lock);
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - info.mtimeMs <= OPERATION_LOCK_TTL_MS) {
        throw new Error(`operación concurrente sobre ${key}; espera al otro proceso`);
      }
      const stalePath = `${lock}.stale-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        /* rename es el takeover atómico: nunca se borra directamente el lock
         * que otro proceso pudo renovar entre stat y cleanup. */
        await fs.rename(lock, stalePath);
        await fs.rm(stalePath, { recursive: true, force: true });
      } catch (takeoverError) {
        if ((takeoverError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw takeoverError;
      }
    }
  }
  throw new Error(`no se pudo adquirir el lock de ${key}`);
}

async function withLock<T>(root: string, key: string, primaryBranch: string, action: () => Promise<T>): Promise<T> {
  const lock = await lockPath(root, key, primaryBranch);
  const token = await acquireLock(lock, key);
  const refresh = setInterval(() => {
    void fs.utimes(lock, new Date(), new Date()).catch(() => undefined);
  }, LOCK_REFRESH_MS);
  refresh.unref?.();
  try {
    return await action();
  } finally {
    clearInterval(refresh);
    try {
      const owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8')) as { token?: unknown };
      if (owner.token === token) await fs.rm(lock, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

async function withTaskLock<T>(root: string, taskId: string, primaryBranch: string, action: () => Promise<T>): Promise<T> {
  return withLock(root, `task-${sanitizeTaskId(taskId)}`, primaryBranch, action);
}

async function hasCaseInsensitiveTaskConflict(root: string, taskId: string, primaryBranch: string): Promise<boolean> {
  const directory = await coordinatorDir(root, primaryBranch);
  try {
    const names = await fs.readdir(directory);
    const expected = `${taskId}.json`.toLowerCase();
    return names.some(name => name.endsWith('.json') && name.toLowerCase() === expected);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function readTask(root: string, taskId: string, primaryBranch: string): Promise<TaskRecord | null> {
  try {
    const record = JSON.parse(await fs.readFile(await taskFilePath(root, taskId, primaryBranch), 'utf8')) as TaskRecord;
    if (record.schemaVersion !== TASK_COORDINATOR_SCHEMA_VERSION || record.taskId !== taskId) {
      throw new Error(`metadata inválida para ${taskId}`);
    }
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function stale(record: TaskRecord, now: number): boolean {
  return now - record.updatedAtMs > TASK_TTL_MS;
}

function createRecord(options: TaskCoordinatorOptions): TaskRecord {
  const now = options.now ?? Date.now();
  const target = requiredPrimaryBranch(options);
  return {
    schemaVersion: 1,
    taskId: sanitizeTaskId(options.taskId),
    agent: sanitizeAgent(options.agent),
    state: 'CLAIMED',
    branch: null,
    worktree: null,
    base: null,
    baseHead: null,
    target: sanitizeBranch(target),
    head: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
    pid: process.pid,
    host: os.hostname(),
  };
}

async function writeTask(root: string, record: TaskRecord): Promise<void> {
  await writeAtomic(await taskFilePath(root, record.taskId, record.target), `${JSON.stringify(record, null, 2)}\n`);
}

function branchFor(taskId: string, identity: string): string {
  return `${taskBranchPrefix(identity)}/${sanitizeTaskId(taskId)}`;
}

const INTERNAL_WORKTREE_ROOT = '.sentinel/worktrees';

function defaultWorktree(repositoryRootPath: string, taskId: string, identity: string): string {
  return path.join(
    repositoryRootPath,
    INTERNAL_WORKTREE_ROOT,
    `${path.basename(repositoryRootPath)}-${identity}-${sanitizeTaskId(taskId)}`,
  );
}

async function resolveWorktreePath(
  root: string,
  requestedPath: string | undefined,
  commonDir: string,
  taskId: string,
  identity: string,
): Promise<string> {
  const repositoryRootPath = await repositoryRoot(root, commonDir);
  const internalRoot = path.join(repositoryRootPath, INTERNAL_WORKTREE_ROOT);
  const requested = requestedPath
    ? path.resolve(root, requestedPath)
    : defaultWorktree(repositoryRootPath, taskId, identity);
  const canonicalInternalRoot = await canonicalPath(internalRoot);
  if (!isStrictlyInside(canonicalInternalRoot, repositoryRootPath)) {
    throw new Error(`la raíz de worktrees ${internalRoot} debe permanecer dentro del repositorio`);
  }
  const canonicalRequested = await canonicalPath(requested);
  if (!isStrictlyInside(canonicalRequested, canonicalInternalRoot)) {
    throw new Error(`el worktree debe estar dentro de ${internalRoot}; no se permiten rutas externas`);
  }
  return requested;
}

async function exists(target: string): Promise<boolean> {
  try { await fs.lstat(target); return true; } catch { return false; }
}

async function branchExists(root: string, branch: string): Promise<boolean> {
  try { await git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]); return true; } catch { return false; }
}

export async function claimTask(options: TaskCoordinatorOptions): Promise<TaskRecord> {
  const root = rootOf(options.projectRoot);
  sanitizeTaskId(options.taskId);
  sanitizeAgent(options.agent);
  const primaryBranch = requiredPrimaryBranch(options);
  return withTaskLock(root, options.taskId, primaryBranch, async () => {
    if (process.platform === 'win32' && await hasCaseInsensitiveTaskConflict(root, options.taskId, primaryBranch)) {
      const exact = await taskFilePath(root, options.taskId, primaryBranch);
      const names = await fs.readdir(path.dirname(exact));
      if (!names.includes(path.basename(exact))) {
        throw new Error(`task-id colisiona con una tarea existente ignorando mayúsculas: ${options.taskId}`);
      }
    }
    const current = await readTask(root, options.taskId, primaryBranch);
    const now = options.now ?? Date.now();
    if (current && !stale(current, now)) {
      if (current.agent !== options.agent) throw new Error(`tarea ${options.taskId} ya está tomada por ${current.agent}`);
      const requestedBranch = options.target ?? options.primaryBranch;
      if (requestedBranch && sanitizeBranch(requestedBranch) !== current.target) {
        throw new Error(`la tarea ${options.taskId} ya está fijada a la rama principal ${current.target}`);
      }
      current.updatedAt = new Date(now).toISOString();
      current.updatedAtMs = now;
      await writeTask(root, current);
      return current;
    }
    if (current && !options.force) throw new Error(`toma expirada para ${options.taskId}; repite con force/takeover explícito`);
    if (current?.worktree || current?.branch) throw new Error(`tarea ${options.taskId} expiró pero conserva recursos; ejecuta status/cleanup antes de retomarla`);
    const record = createRecord(options);
    await writeTask(root, record);
    return record;
  });
}

async function registeredWorktreeFor(root: string, expectedPath: string): Promise<string | null> {
  const output = await git(root, ['worktree', 'list', '--porcelain']);
  let worktree: string | null = null;
  let branch: string | null = null;
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith('worktree ')) {
      worktree = line.slice('worktree '.length);
      branch = null;
    } else if (line.startsWith('branch refs/heads/')) {
      branch = line.slice('branch refs/heads/'.length);
    } else if (!line && worktree) {
      if (path.resolve(worktree) === path.resolve(expectedPath)) return branch;
      worktree = null;
    }
  }
  if (worktree && path.resolve(worktree) === path.resolve(expectedPath)) return branch;
  return null;
}

export async function verifyTaskWorktree(options: TaskCoordinatorOptions): Promise<TaskRecord> {
  const worktree = rootOf(options.projectRoot);
  const primaryBranch = requiredPrimaryBranch(options);
  const record = await readTask(worktree, options.taskId, primaryBranch);
  const identity = projectIdentity(await gitCommonDir(worktree), primaryBranch);
  if (!record || record.agent !== options.agent || record.state !== 'ACTIVE' || !record.worktree || record.branch !== branchFor(options.taskId, identity)) {
    throw new Error(`worktree no autorizado para ${options.taskId}`);
  }
  const [actualPath, expectedPath] = await Promise.all([fs.realpath(worktree), fs.realpath(record.worktree)]);
  if (actualPath !== expectedPath) throw new Error(`el workspace no coincide con el worktree de ${options.taskId}`);
  const registeredBranch = await registeredWorktreeFor(worktree, actualPath);
  if (registeredBranch !== record.branch) throw new Error(`el worktree no está registrado para la rama de ${options.taskId}`);
  return record;
}

export async function heartbeatTask(options: TaskCoordinatorOptions): Promise<TaskRecord> {
  const root = rootOf(options.projectRoot);
  const primaryBranch = requiredPrimaryBranch(options);
  return withTaskLock(root, options.taskId, primaryBranch, async () => {
    const record = await readTask(root, options.taskId, primaryBranch);
    if (!record) throw new Error(`tarea ${options.taskId} no está tomada`);
    if (record.agent !== options.agent) throw new Error(`tarea ${options.taskId} pertenece a ${record.agent}`);
    if (record.state !== 'CLAIMED' && record.state !== 'ACTIVE') throw new Error(`heartbeat inválido en estado ${record.state}`);
    const now = options.now ?? Date.now();
    if (stale(record, now)) throw new Error(`toma expirada para ${options.taskId}; requiere takeover explícito`);
    record.updatedAt = new Date(now).toISOString();
    record.updatedAtMs = now;
    await writeTask(root, record);
    return record;
  });
}

export async function startTask(options: TaskCoordinatorOptions): Promise<TaskRecord> {
  const root = rootOf(options.projectRoot);
  const primaryBranch = requiredPrimaryBranch(options);
  return withTaskLock(root, options.taskId, primaryBranch, async () => {
    const record = await readTask(root, options.taskId, primaryBranch);
    const now = options.now ?? Date.now();
    if (!record || record.agent !== options.agent || stale(record, now)) throw new Error(`toma inválida o expirada para ${options.taskId}`);
    if (record.state !== 'CLAIMED') throw new Error(`tarea ${options.taskId} ya está en estado ${record.state}`);
    if (await gitStatus(root)) throw new Error(`checkout de origen sucio; limpia los cambios antes de iniciar ${options.taskId}`);

    const commonDir = await gitCommonDir(root);
    const identity = projectIdentity(commonDir, primaryBranch);
    const branch = branchFor(options.taskId, identity);
    const worktree = await resolveWorktreePath(
      root,
      options.worktreePath,
      commonDir,
      options.taskId,
      identity,
    );
    const requestedTarget = options.target ?? options.primaryBranch;
    if (requestedTarget && sanitizeBranch(requestedTarget) !== record.target) {
      throw new Error(`la rama principal ${requestedTarget} no coincide con la declarada ${record.target}`);
    }
    const base = sanitizeBranch(options.base ?? options.primaryBranch ?? record.target);
    if (base !== record.target) throw new Error(`la base ${base} no coincide con la rama principal declarada ${record.target}`);
    if (await branchExists(root, branch)) throw new Error(`la rama ${branch} ya existe; no se reutiliza`);
    if (await exists(worktree)) throw new Error(`el worktree ya existe: ${worktree}`);
    const baseHead = await git(root, ['rev-parse', base]);
    await fs.mkdir(path.dirname(worktree), { recursive: true });

    let created = false;
    try {
      await git(root, ['worktree', 'add', '-b', branch, worktree, base]);
      created = true;
      record.state = 'ACTIVE';
      record.branch = branch;
      record.worktree = worktree;
      record.base = base;
      record.baseHead = baseHead;
      record.head = await git(worktree, ['rev-parse', 'HEAD']);
      record.updatedAt = new Date(now).toISOString();
      record.updatedAtMs = now;
      await writeTask(root, record);
      return record;
    } catch (error) {
      if (created) {
        await git(root, ['worktree', 'remove', worktree]).catch(() => undefined);
        await git(root, ['branch', '-D', branch]).catch(() => undefined);
      }
      throw error;
    }
  });
}

export async function integrateTask(options: TaskCoordinatorOptions): Promise<TaskRecord> {
  const root = rootOf(options.projectRoot);
  const primaryBranch = requiredPrimaryBranch(options);
  return withTaskLock(root, options.taskId, primaryBranch, async () => {
    const record = await readTask(root, options.taskId, primaryBranch);
    if (!record || record.agent !== options.agent || !record.branch || !record.worktree || (record.state !== 'ACTIVE' && record.state !== 'INTEGRATING')) {
      throw new Error(`tarea ${options.taskId} no está activa para integración`);
    }
    const target = sanitizeBranch(options.target ?? options.primaryBranch ?? record.target);
    if (target !== record.target) throw new Error(`target distinto al declarado para ${options.taskId}`);

    const commonDir = await gitCommonDir(root);
    const targetIdentity = projectIdentity(commonDir, target);
    /* The target lock isolates project metadata; the repository lock also
     * serializes checkout/merge operations because this integration checkout
     * is a shared mutable Git worktree. Work and gates remain parallel. */
    return withLock(root, `integration-${crypto.createHash('sha256').update(commonDir).digest('hex').slice(0, 16)}`, target, async () =>
      withLock(root, `target-${targetIdentity}`, target, async () => {
      if (await gitStatus(root)) throw new Error(`target sucio; no se integra ${options.taskId}`);
      if (await git(root, ['symbolic-ref', '--short', 'HEAD']) !== target) throw new Error(`checkout actual no es ${target}`);
      const worktree = record.worktree as string;
      const branch = record.branch as string;
      if (await gitStatus(worktree)) throw new Error(`worktree sucio; no se integra ${options.taskId}`);
      const head = await git(worktree, ['rev-parse', 'HEAD']);
      if (await git(root, ['rev-parse', branch]) !== head) throw new Error(`la rama ${branch} no coincide con el HEAD del worktree`);

      const targetHead = await git(root, ['rev-parse', target]);
      if (record.state === 'ACTIVE' && stale(record, options.now ?? Date.now()) && !options.force) {
        throw new Error(`toma expirada para ${options.taskId}; requiere takeover explícito`);
      }
      if (record.state === 'ACTIVE') {
        if (targetHead !== record.baseHead) throw new Error(`la base ${target} avanzó; revalida la tarea antes de integrar`);
        if (head === record.head) throw new Error(`la tarea ${options.taskId} no tiene un commit nuevo`);
        record.state = 'INTEGRATING';
        record.head = head;
        await writeTask(root, record);
        try {
          await git(root, ['merge', '--ff-only', branch]);
        } catch (error) {
          record.state = 'ACTIVE';
          await writeTask(root, record).catch(() => undefined);
          throw error;
        }
      } else if (targetHead === record.baseHead) {
        await git(root, ['merge', '--ff-only', branch]);
      } else if (targetHead !== head) {
        throw new Error(`integración incompleta: ${target} no apunta al commit de ${options.taskId}`);
      }

      record.state = 'INTEGRATED';
      record.head = head;
      const now = options.now ?? Date.now();
      record.updatedAt = new Date(now).toISOString();
      record.updatedAtMs = now;
      await writeTask(root, record);
      return record;
      })
    );
  });
}

async function processAlive(record: TaskRecord): Promise<boolean> {
  if (record.host !== os.hostname() || !Number.isInteger(record.pid) || record.pid <= 0) return false;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export async function cleanupTask(options: TaskCoordinatorOptions): Promise<void> {
  const root = rootOf(options.projectRoot);
  const primaryBranch = requiredPrimaryBranch(options);
  return withTaskLock(root, options.taskId, primaryBranch, async () => {
    const record = await readTask(root, options.taskId, primaryBranch);
    if (!record) return;
    if (record.agent !== options.agent) throw new Error(`tarea ${options.taskId} pertenece a ${record.agent}`);
    const forcedExpired = Boolean(options.force) && stale(record, options.now ?? Date.now());
    if (record.state !== 'INTEGRATED' && !forcedExpired) throw new Error(`cleanup bloqueado: ${options.taskId} está en ${record.state}`);
    if (forcedExpired && await processAlive(record)) throw new Error(`cleanup bloqueado: el proceso ${record.pid} de ${options.taskId} sigue vivo`);

    /* Validate all metadata-derived resources before removing anything. This
     * prevents a corrupted/stale record from making cleanup remove another
     * task's worktree or an arbitrary path. */
    const commonDir = await gitCommonDir(root);
    const identity = projectIdentity(commonDir, record.target);
    const expectedBranch = branchFor(record.taskId, identity);
    if (record.branch && record.branch !== expectedBranch) {
      throw new Error(`cleanup bloqueado: la rama de ${options.taskId} no coincide con su namespace`);
    }
    let recordedWorktree: string | null = null;
    if (record.worktree) {
      recordedWorktree = await resolveWorktreePath(root, record.worktree, commonDir, record.taskId, identity);
      if (await exists(recordedWorktree)) {
        const canonicalWorktree = await fs.realpath(recordedWorktree);
        const registeredBranch = await registeredWorktreeFor(root, canonicalWorktree);
        if (registeredBranch !== record.branch && record.state !== 'INTEGRATED') {
          throw new Error(`cleanup bloqueado: el worktree no pertenece a la rama de ${options.taskId}`);
        }
        if (await gitStatus(canonicalWorktree)) throw new Error(`cleanup bloqueado: worktree sucio ${canonicalWorktree}`);
        recordedWorktree = canonicalWorktree;
      }
    }
    if (recordedWorktree && await exists(recordedWorktree)) {
      await git(root, ['worktree', 'remove', recordedWorktree]);
    }
    if (record.branch && await branchExists(root, record.branch)) {
      if (record.state === 'INTEGRATED' && record.head) {
        const isAncestor = await git(root, ['merge-base', '--is-ancestor', record.head, record.target])
          .then(() => true)
          .catch(() => false);
        if (!isAncestor) throw new Error(`cleanup bloqueado: ${record.head} no está integrado en ${record.target}`);
      }
      /* An INTEGRATED task may be cleaned while another project branch is
       * checked out. Integration already proved ownership and ancestry; the
       * deterministic namespace check above prevents deleting an arbitrary
       * branch. */
      await git(root, ['branch', '-D', record.branch]);
    }
    await fs.rm(await taskFilePath(root, options.taskId, record.target), { force: true });
  });
}

export async function releaseTask(options: TaskCoordinatorOptions): Promise<void> {
  const root = rootOf(options.projectRoot);
  const primaryBranch = requiredPrimaryBranch(options);
  return withTaskLock(root, options.taskId, primaryBranch, async () => {
    const record = await readTask(root, options.taskId, primaryBranch);
    if (!record) return;
    if (record.agent !== options.agent) throw new Error(`tarea ${options.taskId} pertenece a ${record.agent}`);
    if (record.state === 'ACTIVE' || record.state === 'INTEGRATING') throw new Error(`release bloqueado: integra o abandona ${options.taskId}`);
    if (record.state === 'INTEGRATED') throw new Error(`cleanup requerido antes de release ${options.taskId}`);
    await fs.rm(await taskFilePath(root, options.taskId, record.target), { force: true });
  });
}

async function registeredTaskWorktrees(root: string, branchPrefix: string): Promise<{ paths: Set<string>; branches: Set<string> }> {
  const output = await git(root, ['worktree', 'list', '--porcelain']);
  const paths = new Set<string>();
  const branches = new Set<string>();
  let worktree: string | null = null;
  let branch: string | null = null;
  const flush = () => {
    if (worktree && branch?.startsWith(`${branchPrefix}/`)) {
      paths.add(path.resolve(worktree));
      branches.add(branch);
    }
    worktree = null;
    branch = null;
  };
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith('worktree ')) { flush(); worktree = line.slice('worktree '.length); }
    else if (line.startsWith('branch refs/heads/')) branch = line.slice('branch refs/heads/'.length);
  }
  flush();
  return { paths, branches };
}

export async function taskStatus(projectRoot: string, primaryBranch: string): Promise<TaskStatusResult> {
  const root = rootOf(projectRoot);
  const normalizedPrimaryBranch = sanitizeBranch(primaryBranch);
  const directory = await coordinatorDir(root, normalizedPrimaryBranch);
  let names: string[] = [];
  try { names = (await fs.readdir(directory)).filter(name => name.endsWith('.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const tasks: TaskRecord[] = [];
  const invalidMetadata: string[] = [];
  for (const name of names) {
    try {
      const value = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) as TaskRecord;
      if (value.schemaVersion !== TASK_COORDINATOR_SCHEMA_VERSION || !value.taskId) throw new Error('schema inválido');
      tasks.push(value);
    } catch { invalidMetadata.push(name); }
  }
  const knownPaths = new Set(tasks.map(task => task.worktree).filter((value): value is string => Boolean(value)).map(value => path.resolve(value)));
  const knownBranches = new Set(tasks.map(task => task.branch).filter((value): value is string => Boolean(value)));
  const commonDir = await gitCommonDir(root);
  const branchPrefix = taskBranchPrefix(projectIdentity(commonDir, normalizedPrimaryBranch));
  const registered = await registeredTaskWorktrees(root, branchPrefix);
  const branches = (await git(root, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${branchPrefix}/`]))
    .split(/\r?\n/u).filter(Boolean);
  let locks: string[] = [];
  try {
    locks = (await fs.readdir(directory)).filter(name => name.endsWith('.lock'));
  } catch { /* la ausencia del directorio ya equivale a cero locks */ }
  const expiredLocks: string[] = [];
  for (const lock of locks) {
    try { if (Date.now() - (await fs.stat(path.join(directory, lock))).mtimeMs > OPERATION_LOCK_TTL_MS) expiredLocks.push(lock); }
    catch { /* desapareció durante status */ }
  }
  return {
    tasks,
    invalidMetadata,
    orphanWorktrees: [...registered.paths].filter(value => !knownPaths.has(value)),
    orphanBranches: branches.filter(value => !knownBranches.has(value)),
    expiredLocks,
  };
}
