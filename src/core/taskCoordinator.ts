/* [028A-18] Coordinador universal de tareas para Sentinel.
 * La unidad de paralelismo es una tarea por rama/worktree. El estado efímero
 * vive junto al Git común, no dentro del checkout del consumidor. */
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeAtomic } from './atomicFile';

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
  return git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
}

async function gitCommonDir(root: string): Promise<string> {
  return path.resolve(root, await git(root, ['rev-parse', '--git-common-dir']));
}

async function coordinatorDir(root: string): Promise<string> {
  return path.join(await gitCommonDir(root), 'sentinel-task-coordination');
}

async function taskFilePath(root: string, taskId: string): Promise<string> {
  return path.join(await coordinatorDir(root), `${sanitizeTaskId(taskId)}.json`);
}

async function lockPath(root: string, key: string): Promise<string> {
  if (!SAFE_LOCK_KEY.test(key)) throw new Error(`clave de lock inválida: ${key}`);
  return path.join(await coordinatorDir(root), `${key}.lock`);
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

async function withLock<T>(root: string, key: string, action: () => Promise<T>): Promise<T> {
  const lock = await lockPath(root, key);
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

async function withTaskLock<T>(root: string, taskId: string, action: () => Promise<T>): Promise<T> {
  return withLock(root, `task-${sanitizeTaskId(taskId)}`, action);
}

async function hasCaseInsensitiveTaskConflict(root: string, taskId: string): Promise<boolean> {
  const directory = await coordinatorDir(root);
  try {
    const names = await fs.readdir(directory);
    const expected = `${taskId}.json`.toLowerCase();
    return names.some(name => name.endsWith('.json') && name.toLowerCase() === expected);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function readTask(root: string, taskId: string): Promise<TaskRecord | null> {
  try {
    const record = JSON.parse(await fs.readFile(await taskFilePath(root, taskId), 'utf8')) as TaskRecord;
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
  return {
    schemaVersion: 1,
    taskId: sanitizeTaskId(options.taskId),
    agent: sanitizeAgent(options.agent),
    state: 'CLAIMED',
    branch: null,
    worktree: null,
    base: null,
    baseHead: null,
    target: options.target ?? 'main',
    head: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
    pid: process.pid,
    host: os.hostname(),
  };
}

async function writeTask(root: string, record: TaskRecord): Promise<void> {
  await writeAtomic(await taskFilePath(root, record.taskId), `${JSON.stringify(record, null, 2)}\n`);
}

function branchFor(taskId: string): string { return `task/${sanitizeTaskId(taskId)}`; }

function defaultWorktree(root: string, taskId: string, commonDir: string): string {
  const identity = crypto.createHash('sha256').update(commonDir).digest('hex').slice(0, 10);
  return path.resolve(root, '..', '.sentinel-worktrees', `${path.basename(root)}-${identity}-${sanitizeTaskId(taskId)}`);
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
  return withTaskLock(root, options.taskId, async () => {
    if (process.platform === 'win32' && await hasCaseInsensitiveTaskConflict(root, options.taskId)) {
      const exact = await taskFilePath(root, options.taskId);
      const names = await fs.readdir(path.dirname(exact));
      if (!names.includes(path.basename(exact))) {
        throw new Error(`task-id colisiona con una tarea existente ignorando mayúsculas: ${options.taskId}`);
      }
    }
    const current = await readTask(root, options.taskId);
    const now = options.now ?? Date.now();
    if (current && !stale(current, now)) {
      if (current.agent !== options.agent) throw new Error(`tarea ${options.taskId} ya está tomada por ${current.agent}`);
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
  for (const line of output.split(/\\r?\\n/u)) {
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
  const record = await readTask(worktree, options.taskId);
  if (!record || record.agent !== options.agent || record.state !== 'ACTIVE' || !record.worktree || record.branch !== branchFor(options.taskId)) {
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
  return withTaskLock(root, options.taskId, async () => {
    const record = await readTask(root, options.taskId);
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
  return withTaskLock(root, options.taskId, async () => {
    const record = await readTask(root, options.taskId);
    const now = options.now ?? Date.now();
    if (!record || record.agent !== options.agent || stale(record, now)) throw new Error(`toma inválida o expirada para ${options.taskId}`);
    if (record.state !== 'CLAIMED') throw new Error(`tarea ${options.taskId} ya está en estado ${record.state}`);
    if (await gitStatus(root)) throw new Error(`checkout de origen sucio; limpia los cambios antes de iniciar ${options.taskId}`);

    const branch = branchFor(options.taskId);
    const commonDir = await gitCommonDir(root);
    const worktree = path.resolve(options.worktreePath ?? defaultWorktree(root, options.taskId, commonDir));
    const base = options.base ?? 'main';
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
  return withTaskLock(root, options.taskId, async () => {
    const record = await readTask(root, options.taskId);
    if (!record || record.agent !== options.agent || !record.branch || !record.worktree || (record.state !== 'ACTIVE' && record.state !== 'INTEGRATING')) {
      throw new Error(`tarea ${options.taskId} no está activa para integración`);
    }
    const target = options.target ?? record.target;
    if (target !== record.target) throw new Error(`target distinto al declarado para ${options.taskId}`);

    return withLock(root, `target-${target}`, async () => {
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
    });
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
  return withTaskLock(root, options.taskId, async () => {
    const record = await readTask(root, options.taskId);
    if (!record) return;
    if (record.agent !== options.agent) throw new Error(`tarea ${options.taskId} pertenece a ${record.agent}`);
    const forcedExpired = Boolean(options.force) && stale(record, options.now ?? Date.now());
    if (record.state !== 'INTEGRATED' && !forcedExpired) throw new Error(`cleanup bloqueado: ${options.taskId} está en ${record.state}`);
    if (forcedExpired && await processAlive(record)) throw new Error(`cleanup bloqueado: el proceso ${record.pid} de ${options.taskId} sigue vivo`);
    if (record.worktree && await exists(record.worktree)) {
      if (await gitStatus(record.worktree)) throw new Error(`cleanup bloqueado: worktree sucio ${record.worktree}`);
      await git(root, ['worktree', 'remove', record.worktree]);
    }
    if (record.branch && await branchExists(root, record.branch)) {
      await git(root, ['branch', forcedExpired ? '-D' : '-d', record.branch]);
    }
    await fs.rm(await taskFilePath(root, options.taskId), { force: true });
  });
}

export async function releaseTask(options: TaskCoordinatorOptions): Promise<void> {
  const root = rootOf(options.projectRoot);
  return withTaskLock(root, options.taskId, async () => {
    const record = await readTask(root, options.taskId);
    if (!record) return;
    if (record.agent !== options.agent) throw new Error(`tarea ${options.taskId} pertenece a ${record.agent}`);
    if (record.state === 'ACTIVE' || record.state === 'INTEGRATING') throw new Error(`release bloqueado: integra o abandona ${options.taskId}`);
    if (record.state === 'INTEGRATED') throw new Error(`cleanup requerido antes de release ${options.taskId}`);
    await fs.rm(await taskFilePath(root, options.taskId), { force: true });
  });
}

async function registeredTaskWorktrees(root: string): Promise<{ paths: Set<string>; branches: Set<string> }> {
  const output = await git(root, ['worktree', 'list', '--porcelain']);
  const paths = new Set<string>();
  const branches = new Set<string>();
  let worktree: string | null = null;
  let branch: string | null = null;
  const flush = () => {
    if (worktree && branch?.startsWith('task/')) {
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

export async function taskStatus(projectRoot: string): Promise<TaskStatusResult> {
  const root = rootOf(projectRoot);
  const directory = await coordinatorDir(root);
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
  const registered = await registeredTaskWorktrees(root);
  const branches = (await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/task/']))
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
