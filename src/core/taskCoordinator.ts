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
import { IgnoredBaselineSnapshot, IgnoredInputSnapshot, MissingTaskInputError, provisionTaskInputs, resolveEnvManifestPath, validateIgnoredInputs } from './envManifest';
import { canonicalPath, isStrictlyInside } from './pathSafety';
import { assertSafeBranch, isSafeBranch } from './branchValidation';

const execFileAsync = promisify(execFile);
export const TASK_COORDINATOR_SCHEMA_VERSION = 3;
export const TASK_TTL_MS = 6 * 60 * 60 * 1000;
const OPERATION_LOCK_TTL_MS = 30 * 60 * 1000;
const LOCK_REFRESH_MS = 60 * 1000;

export type TaskState = 'CLAIMED' | 'ACTIVE' | 'INTEGRATING' | 'INTEGRATED';
export type TaskTerminalState = 'CLEANED' | 'RELEASED' | 'RECOVERED';

export interface TaskEvent {
  eventId: string;
  at: string;
  actor: string;
  action: string;
  fromState: TaskState | null;
  toState: TaskState | TaskTerminalState;
  reason?: string;
  exitCode?: number;
  result?: string;
}

export interface TaskGateRun {
  at: string;
  actor: string;
  mode: 'local' | 'full' | 'ci';
  status: 'PASS' | 'FAIL' | 'ERROR';
  exitCode: number;
  reportPath?: string;
}

export interface TaskRecord {
  schemaVersion: 3;
  /** Optional fields are additive so records written by 0.6.4 remain readable. */
  summary?: string;
  planReference?: string | null;
  relatedTaskIds?: string[];
  history?: TaskEvent[];
  gateRuns?: TaskGateRun[];
  commits?: string[];
  changedFiles?: string[];
  terminalState?: TaskTerminalState;
  archivedAt?: string;
  archivedBy?: string;
  archivedReason?: string;
  taskId: string;
  agent: string;
  state: TaskState;
  branch: string | null;
  worktree: string | null;
  worktreesRoot: string | null;
  /** Entradas ignored-local declaradas por la tarea y su permiso de edición. */
  ignoredInputs: IgnoredInputSnapshot[];
  /** null conserva el comportamiento previo cuando no hay manifiesto. */
  ignoredBaseline: IgnoredBaselineSnapshot[] | null;
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
  /** Raíz autorizada para worktrees temporales. Por defecto: <repo>/.sentinel/worktrees.
   *  Solo se admite una raíz externa declarada por el consumidor; nunca una ruta arbitraria. */
  worktreesRoot?: string;
  /** Manifiesto de entorno para provisionar entradas dentro del worktree
   *  (contrato [VISIBLE-WORKTREE]). Por defecto: <projectRoot>/sentinel.env-manifest.json si existe. */
  envManifestPath?: string;
  base?: string;
  target?: string;
  /** Rama principal declarada por el consumidor; nunca se infiere como `main`. */
  primaryBranch?: string;
  force?: boolean;
  /** Snapshot de recuperación: impide limpiar metadata que cambió durante el diagnóstico. */
  expectedUpdatedAtMs?: number;
  expectedPid?: number;
  expectedHead?: string | null;
  summary?: string;
  planReference?: string | null;
  relatedTaskIds?: string[];
  cleanupTerminalState?: TaskTerminalState;
  cleanupActor?: string;
  cleanupReason?: string;
}

export interface TaskStatusRecord extends TaskRecord {
  expired: boolean;
  processAlive: boolean;
  worktreeClean: boolean | null;
}

export interface TaskLegacyOrphan {
  metadataPath: string;
  taskId: string;
  target: string | null;
  branch: string | null;
  worktree: string | null;
  reason: string;
}

export interface TaskStatusResult {
  tasks: TaskStatusRecord[];
  invalidMetadata: string[];
  legacyOrphans: TaskLegacyOrphan[];
  orphanWorktrees: string[];
  orphanBranches: string[];
  expiredLocks: string[];
  history: TaskHistoryRecord[];
  physicalOrphanWorktrees: string[];
}

export interface TaskHistoryRecord {
  archiveSchemaVersion: 1;
  taskId: string;
  projectIdentity: string;
  terminalState: TaskTerminalState;
  archivedAt: string;
  archivedBy: string;
  archivedReason?: string;
  record: TaskRecord;
}

const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_AGENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_LOCK_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_PROJECT_IDENTITY = /^[a-f0-9]{16}$/u;
const MAX_HISTORY_EVENTS = 200;
const MAX_HISTORY_FILES = 2000;
const MAX_TEXT = 500;

function boundedText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > MAX_TEXT) throw new Error(`${label} supera ${MAX_TEXT} caracteres`);
  return normalized || undefined;
}

function safeRelativeReference(value: string | null | undefined, label: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = value.replace(/\\/gu, '/');
  if (!normalized || path.isAbsolute(value) || normalized.split('/').includes('..')) {
    throw new Error(`${label} debe ser una ruta relativa dentro del proyecto`);
  }
  return boundedText(normalized, label);
}

function eventId(now: number): string {
  return `${now}-${crypto.randomBytes(6).toString('hex')}`;
}

function appendTaskEvent(record: TaskRecord, event: Omit<TaskEvent, 'eventId' | 'at'> & { now: number }): void {
  const events = record.history ?? [];
  events.push({ eventId: eventId(event.now), at: new Date(event.now).toISOString(), ...event });
  record.history = events.slice(-MAX_HISTORY_EVENTS);
}

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

async function repositoryRoot(root: string, commonDir: string): Promise<string> {
  /* A linked worktree reports its own top level, while --git-common-dir still
   * points at the main repository's .git. Prefer that common root when it is
   * available; submodules keep their own top-level fallback. Un worktree
   * externo autorizado (raíz visible del workspace) vive como hermano de la
   * raíz Git, así que su top level NO está dentro de ella: se acepta porque
   * la identidad y la metadata siguen ancladas al common dir del repositorio. */
  const topLevel = await gitTopLevel(root);
  const commonRoot = path.basename(commonDir).toLowerCase() === '.git'
    ? path.dirname(commonDir)
    : topLevel;
  const canonicalRoot = await canonicalPath(commonRoot);
  /* Worktree vinculado (interno o externo): su top level puede estar fuera de
   * la raíz común; la autoridad del proyecto sigue siendo la raíz común. */
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
  let result: T;
  let actionError: unknown;
  try {
    result = await action();
  } catch (error) {
    actionError = error;
  } finally {
    clearInterval(refresh);
  }
  let cleanupError: unknown;
  try {
    const owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8')) as { token?: unknown };
    if (owner.token === token) await fs.rm(lock, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupError = error;
  }
  if (actionError !== undefined) throw actionError;
  if (cleanupError !== undefined) throw cleanupError;
  return result!;
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
    const value: unknown = JSON.parse(await fs.readFile(await taskFilePath(root, taskId, primaryBranch), 'utf8'));
    const normalized = normalizeTaskRecord(value);
    if (!normalized || normalized.record.taskId !== taskId || normalized.record.target !== primaryBranch) {
      throw new Error(`metadata inválida para ${taskId}`);
    }
    if (normalized.migrated) await writeTask(root, normalized.record);
    return normalized.record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function stale(record: TaskRecord, now: number): boolean {
  return now - record.updatedAtMs > TASK_TTL_MS;
}

function validTaskEvent(value: unknown): value is TaskEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<TaskEvent>;
  const validFromState = (state: unknown): state is TaskState | null =>
    state === null || ['CLAIMED', 'ACTIVE', 'INTEGRATING', 'INTEGRATED'].includes(state as string);
  const validToState = (state: unknown): state is TaskState | TaskTerminalState =>
    ['CLAIMED', 'ACTIVE', 'INTEGRATING', 'INTEGRATED', 'CLEANED', 'RELEASED', 'RECOVERED'].includes(state as string);
  return typeof event.eventId === 'string' && event.eventId.length > 0 && event.eventId.length <= 128
    && typeof event.at === 'string' && Number.isFinite(Date.parse(event.at))
    && typeof event.actor === 'string' && SAFE_AGENT.test(event.actor)
    && typeof event.action === 'string' && event.action.length > 0 && event.action.length <= 64
    && validFromState(event.fromState) && validToState(event.toState)
    && (event.reason === undefined || (typeof event.reason === 'string' && event.reason.length <= MAX_TEXT))
    && (event.exitCode === undefined || (Number.isInteger(event.exitCode) && event.exitCode >= 0 && event.exitCode <= 255))
    && (event.result === undefined || (typeof event.result === 'string' && event.result.length <= MAX_TEXT));
}

function validTaskGateRun(value: unknown): value is TaskGateRun {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const gate = value as Partial<TaskGateRun>;
  const reportPath = gate.reportPath;
  const exitCode = gate.exitCode;
  return typeof gate.at === 'string' && Number.isFinite(Date.parse(gate.at))
    && typeof gate.actor === 'string' && SAFE_AGENT.test(gate.actor)
    && ['local', 'full', 'ci'].includes(gate.mode ?? '')
    && ['PASS', 'FAIL', 'ERROR'].includes(gate.status ?? '')
    && typeof exitCode === 'number' && Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255
    && (reportPath === undefined || (typeof reportPath === 'string' && !path.isAbsolute(reportPath)
      && !reportPath.replace(/\\/gu, '/').split('/').includes('..') && reportPath.length <= MAX_TEXT));
}

function validTaskRecord(value: unknown): value is TaskRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<TaskRecord>;
  if (record.schemaVersion !== TASK_COORDINATOR_SCHEMA_VERSION
    || typeof record.taskId !== 'string' || !SAFE_TASK_ID.test(record.taskId)
    || typeof record.agent !== 'string' || !SAFE_AGENT.test(record.agent)
    || !['CLAIMED', 'ACTIVE', 'INTEGRATING', 'INTEGRATED'].includes(record.state ?? '')
    || (record.branch !== null && (typeof record.branch !== 'string' || !isSafeBranch(record.branch)))
    || (record.worktree !== null && typeof record.worktree !== 'string')
    || (record.worktreesRoot !== null && typeof record.worktreesRoot !== 'string')
    || !Array.isArray(record.ignoredInputs)
    || record.ignoredInputs.some(item => !item || typeof item !== 'object' || typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.replace(/\\/gu, '/').split('/').includes('..') || !/^[a-f0-9]{64}$/u.test(item.sha256) || typeof item.editable !== 'boolean')
    || (record.ignoredBaseline !== null && (!Array.isArray(record.ignoredBaseline) || record.ignoredBaseline.some(item => !item || typeof item !== 'object' || typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.replace(/\\/gu, '/').split('/').includes('..') || !/^[a-f0-9]{64}$/u.test(item.sha256))))
    || (record.base !== null && (typeof record.base !== 'string' || !isSafeBranch(record.base)))
    || (record.baseHead !== null && (typeof record.baseHead !== 'string' || !/^[a-f0-9]{40}$/u.test(record.baseHead)))
    || typeof record.target !== 'string' || !isSafeBranch(record.target)
    || (record.head !== null && (typeof record.head !== 'string' || !/^[a-f0-9]{40}$/u.test(record.head)))
    || typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string'
    || !Number.isFinite(record.updatedAtMs) || typeof record.pid !== 'number' || !Number.isFinite(record.pid) || record.pid <= 0
    || typeof record.host !== 'string' || record.host.length === 0
    || (record.summary !== undefined && (typeof record.summary !== 'string' || record.summary.length > MAX_TEXT))
    || (record.planReference !== undefined && record.planReference !== null && (typeof record.planReference !== 'string' || path.isAbsolute(record.planReference) || record.planReference.replace(/\\/gu, '/').split('/').includes('..')))
    || (record.relatedTaskIds !== undefined && (!Array.isArray(record.relatedTaskIds) || record.relatedTaskIds.some(item => typeof item !== 'string' || !SAFE_TASK_ID.test(item))))
    || (record.history !== undefined && (!Array.isArray(record.history) || record.history.length > MAX_HISTORY_EVENTS || record.history.some(event => !validTaskEvent(event))))
    || (record.gateRuns !== undefined && (!Array.isArray(record.gateRuns) || record.gateRuns.length > 50 || record.gateRuns.some(run => !validTaskGateRun(run))))
    || (record.commits !== undefined && (!Array.isArray(record.commits) || record.commits.some(item => typeof item !== 'string' || !/^[a-f0-9]{40}$/u.test(item))))
    || (record.changedFiles !== undefined && (!Array.isArray(record.changedFiles) || record.changedFiles.some(item => typeof item !== 'string' || path.isAbsolute(item) || item.replace(/\\/gu, '/').split('/').includes('..'))))) return false;
  return true;
}

function normalizeTaskRecord(value: unknown): { record: TaskRecord; migrated: boolean } | null {
  if (validTaskRecord(value)) return { record: value, migrated: false };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const legacy = value as Record<string, unknown>;
  if (legacy.schemaVersion !== 1 && legacy.schemaVersion !== 2) return null;
  const migrated = {
    ...legacy,
    schemaVersion: TASK_COORDINATOR_SCHEMA_VERSION,
    branch: legacy.branch ?? null,
    worktree: legacy.worktree ?? null,
    worktreesRoot: legacy.worktreesRoot ?? null,
    ignoredInputs: Array.isArray(legacy.ignoredInputs) ? legacy.ignoredInputs : [],
    ignoredBaseline: legacy.ignoredBaseline === undefined ? null : legacy.ignoredBaseline,
    base: legacy.base ?? null,
    baseHead: legacy.baseHead ?? null,
    head: legacy.head ?? null,
    history: Array.isArray(legacy.history) ? legacy.history : [],
    gateRuns: Array.isArray(legacy.gateRuns) ? legacy.gateRuns : [],
    commits: Array.isArray(legacy.commits) ? legacy.commits : [],
    changedFiles: Array.isArray(legacy.changedFiles) ? legacy.changedFiles : [],
  };
  return validTaskRecord(migrated) ? { record: migrated, migrated: true } : null;
}

function createRecord(options: TaskCoordinatorOptions): TaskRecord {
  const now = options.now ?? Date.now();
  const target = requiredPrimaryBranch(options);
  const summary = boundedText(options.summary, 'summary');
  const planReference = safeRelativeReference(options.planReference, 'planReference');
  const relatedTaskIds = (options.relatedTaskIds ?? []).map(sanitizeTaskId);
  const record: TaskRecord = {
    schemaVersion: TASK_COORDINATOR_SCHEMA_VERSION,
    taskId: sanitizeTaskId(options.taskId),
    agent: sanitizeAgent(options.agent),
    state: 'CLAIMED',
    branch: null,
    worktree: null,
    worktreesRoot: null,
    ignoredInputs: [],
    ignoredBaseline: null,
    base: null,
    baseHead: null,
    target: sanitizeBranch(target),
    head: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
    pid: process.pid,
    host: os.hostname(),
    ...(summary ? { summary } : {}),
    ...(planReference !== undefined ? { planReference } : {}),
    ...(relatedTaskIds.length > 0 ? { relatedTaskIds } : {}),
    history: [],
    gateRuns: [],
    commits: [],
    changedFiles: [],
  };
  appendTaskEvent(record, {
    now,
    actor: record.agent,
    action: 'CLAIM',
    fromState: null,
    toState: 'CLAIMED',
    reason: summary,
  });
  return record;
}

async function archiveTask(root: string, record: TaskRecord, terminalState: TaskTerminalState, actor: string, reason?: string, now = Date.now()): Promise<void> {
  const commonDir = await gitCommonDir(root);
  const identity = projectIdentity(commonDir, record.target);
  const directory = path.join(await coordinatorDir(root, record.target), '..', '..', 'history', identity);
  await fs.mkdir(directory, { recursive: true });
  const archived: TaskHistoryRecord = {
    archiveSchemaVersion: 1,
    taskId: record.taskId,
    projectIdentity: identity,
    terminalState,
    archivedAt: new Date(now).toISOString(),
    archivedBy: actor,
    ...(reason ? { archivedReason: boundedText(reason, 'cleanupReason') } : {}),
    record: {
      ...record,
      terminalState,
      archivedAt: new Date(now).toISOString(),
      archivedBy: actor,
      ...(reason ? { archivedReason: boundedText(reason, 'cleanupReason') } : {}),
    },
  };
  const archivePath = path.join(directory, `${sanitizeTaskId(record.taskId)}-${now}-${eventId(now)}.json`);
  await writeAtomic(archivePath, `${JSON.stringify(archived, null, 2)}\n`);
}

async function collectTaskEvidence(worktree: string, baseHead: string | null, head: string): Promise<{ commits: string[]; changedFiles: string[] }> {
  if (!baseHead) return { commits: [head], changedFiles: [] };
  const commits = (await git(worktree, ['log', '--format=%H', `${baseHead}..${head}`])).split(/\\r?\\n/u).filter(Boolean);
  const changedFiles = (await git(worktree, ['diff', '--name-only', `${baseHead}..${head}`])).split(/\\r?\\n/u).filter(Boolean).map(value => value.replace(/\\/gu, '/'));
  return { commits, changedFiles };
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
  worktreesRoot?: string,
): Promise<{ worktree: string; worktreesRoot: string }> {
  const repositoryRootPath = await repositoryRoot(root, commonDir);
  const internalRoot = path.join(repositoryRootPath, INTERNAL_WORKTREE_ROOT);
  const defaultWorktreePath = defaultWorktree(repositoryRootPath, taskId, identity);

  /* [VISIBLE-WORKTREE] Raíz autorizada por el consumidor (por ejemplo una
   * carpeta visible del workspace del agente). Solo se acepta una raíz externa
   * declarada explícitamente; una ruta arbitraria sigue bloqueada. La raíz
   * externa debe existir (canonicalPath la resuelve) y quedar fuera del
   * repositorio; el path real se rechaza si es symlink/junction de escape. */
  let authorizedRoot = internalRoot;
  if (worktreesRoot) {
    const canonicalExternal = await canonicalPath(path.resolve(worktreesRoot));
    if (canonicalExternal === repositoryRootPath || isStrictlyInside(canonicalExternal, repositoryRootPath)) {
      throw new Error(`la raíz de worktrees ${worktreesRoot} no puede ser el repositorio ni una subcarpeta de él`);
    }
    authorizedRoot = canonicalExternal;
  }

  const canonicalAuthorizedRoot = await canonicalPath(authorizedRoot);
  if (!worktreesRoot && !isStrictlyInside(canonicalAuthorizedRoot, repositoryRootPath)) {
    throw new Error(`la raíz de worktrees ${internalRoot} debe permanecer dentro del repositorio`);
  }

  const requested = requestedPath
    ? path.resolve(root, requestedPath)
    : worktreesRoot
      ? path.join(authorizedRoot, `${path.basename(repositoryRootPath)}-${identity}-${sanitizeTaskId(taskId)}`)
      : defaultWorktreePath;
  const canonicalRequested = await canonicalPath(requested);
  if (!isStrictlyInside(canonicalRequested, canonicalAuthorizedRoot)) {
    throw new Error(`el worktree debe estar dentro de ${authorizedRoot}; no se permiten rutas externas`);
  }
  return { worktree: requested, worktreesRoot: authorizedRoot };
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
      const previousState = current.state;
      current.updatedAt = new Date(now).toISOString();
      current.updatedAtMs = now;
      appendTaskEvent(current, { now, actor: current.agent, action: 'CLAIM_REFRESH', fromState: previousState, toState: previousState });
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
  if (record.ignoredBaseline !== null) await validateIgnoredInputs(actualPath, record.ignoredInputs, record.ignoredBaseline);
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
    const previousState = record.state;
    record.updatedAt = new Date(now).toISOString();
    record.updatedAtMs = now;
    record.pid = process.pid;
    appendTaskEvent(record, { now, actor: record.agent, action: 'HEARTBEAT', fromState: previousState, toState: previousState });
    record.host = os.hostname();
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
    const resolved = await resolveWorktreePath(
      root,
      options.worktreePath,
      commonDir,
      options.taskId,
      identity,
      options.worktreesRoot,
    );
    const worktree = resolved.worktree;
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
      const envManifestPath = await resolveEnvManifestPath(root, options.envManifestPath);
      if (envManifestPath) {
        const { missing, ignoredInputs, ignoredBaseline } = await provisionTaskInputs(root, worktree, envManifestPath);
        if (missing.length > 0) throw new MissingTaskInputError(missing);
        record.ignoredInputs = ignoredInputs;
        record.ignoredBaseline = ignoredBaseline;
      }
      record.state = 'ACTIVE';
      appendTaskEvent(record, { now, actor: record.agent, action: 'START', fromState: 'CLAIMED', toState: 'ACTIVE' });
      record.branch = branch;
      record.worktree = worktree;
      record.worktreesRoot = options.worktreesRoot ? resolved.worktreesRoot : null;
      record.base = base;
      record.baseHead = baseHead;
      record.head = await git(worktree, ['rev-parse', 'HEAD']);
      record.updatedAt = new Date(now).toISOString();
      record.updatedAtMs = now;
      await writeTask(root, record);
      return record;
    } catch (error) {
      if (created) {
        await git(root, ['worktree', 'remove', '--force', worktree]).catch(() => undefined);
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
      const branch = record.branch as string;
      const resolvedWorktree = await resolveWorktreePath(
        root,
        record.worktree as string,
        commonDir,
        record.taskId,
        targetIdentity,
        record.worktreesRoot ?? undefined,
      );
      const worktree = await fs.realpath(resolvedWorktree.worktree);
      const registeredBranch = await registeredWorktreeFor(root, worktree);
      if (registeredBranch !== branch) throw new Error(`el worktree no está registrado para la rama de ${options.taskId}`);
      if (record.ignoredBaseline !== null) await validateIgnoredInputs(worktree, record.ignoredInputs, record.ignoredBaseline);
      if (await gitStatus(worktree)) throw new Error(`worktree sucio; no se integra ${options.taskId}`);
      const head = await git(worktree, ['rev-parse', 'HEAD']);
      if (await git(root, ['rev-parse', branch]) !== head) throw new Error(`la rama ${branch} no coincide con el HEAD del worktree`);
      const evidence = await collectTaskEvidence(worktree, record.baseHead, head);
      record.commits = evidence.commits;
      record.changedFiles = evidence.changedFiles;

      const targetHead = await git(root, ['rev-parse', target]);
      if (record.state === 'ACTIVE' && stale(record, options.now ?? Date.now()) && !options.force) {
        throw new Error(`toma expirada para ${options.taskId}; requiere takeover explícito`);
      }
      if (record.state === 'ACTIVE') {
        if (targetHead !== record.baseHead) throw new Error(`la base ${target} avanzó; revalida la tarea antes de integrar`);
        if (head === record.head) throw new Error(`la tarea ${options.taskId} no tiene un commit nuevo`);
        record.state = 'INTEGRATING';
        record.head = head;
        appendTaskEvent(record, { now: options.now ?? Date.now(), actor: record.agent, action: 'INTEGRATE_START', fromState: 'ACTIVE', toState: 'INTEGRATING' });
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
      appendTaskEvent(record, { now, actor: record.agent, action: 'INTEGRATE', fromState: 'INTEGRATING', toState: 'INTEGRATED', result: 'PASS' });
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

async function worktreeClean(worktree: string | null): Promise<boolean | null> {
  if (!worktree) return null;
  try {
    return (await gitStatus(worktree)).length === 0;
  } catch {
    return false;
  }
}

export async function cleanupTask(options: TaskCoordinatorOptions): Promise<TaskTerminalState | null> {
  const root = rootOf(options.projectRoot);
  const primaryBranch = requiredPrimaryBranch(options);
  return withTaskLock(root, options.taskId, primaryBranch, async () => {
    const record = await readTask(root, options.taskId, primaryBranch);
    if (!record) return null;
    if (record.agent !== options.agent) throw new Error(`tarea ${options.taskId} pertenece a ${record.agent}`);
    if (options.expectedUpdatedAtMs !== undefined && record.updatedAtMs !== options.expectedUpdatedAtMs) {
      throw new Error(`cleanup bloqueado: metadata de ${options.taskId} cambió durante la recuperación`);
    }
    if (options.expectedPid !== undefined && record.pid !== options.expectedPid) {
      throw new Error(`cleanup bloqueado: PID de ${options.taskId} cambió durante la recuperación`);
    }
    if (options.expectedHead !== undefined && record.head !== options.expectedHead) {
      throw new Error(`cleanup bloqueado: HEAD de ${options.taskId} cambió durante la recuperación`);
    }
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
      recordedWorktree = (await resolveWorktreePath(root, record.worktree, commonDir, record.taskId, identity, record.worktreesRoot ?? undefined)).worktree;
      if (await exists(recordedWorktree)) {
        const canonicalWorktree = await fs.realpath(recordedWorktree);
        const registeredBranch = await registeredWorktreeFor(root, canonicalWorktree);
        if (registeredBranch !== record.branch) {
          throw new Error(`cleanup bloqueado: el worktree no pertenece a la rama de ${options.taskId}`);
        }
        if (await gitStatus(canonicalWorktree)) throw new Error(`cleanup bloqueado: worktree sucio ${canonicalWorktree}`);
        recordedWorktree = canonicalWorktree;
      }
    }
    const now = options.now ?? Date.now();
    const terminalState = options.cleanupTerminalState ?? (forcedExpired ? 'RECOVERED' : 'CLEANED');
    appendTaskEvent(record, { now, actor: options.cleanupActor ?? options.agent, action: terminalState, fromState: record.state, toState: terminalState, reason: options.cleanupReason });
    if (recordedWorktree && await exists(recordedWorktree)) {
      if (record.ignoredBaseline !== null) await validateIgnoredInputs(recordedWorktree, record.ignoredInputs, record.ignoredBaseline);
      await git(root, ['worktree', 'remove', '--force', recordedWorktree]);
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
    /* Archive only after every destructive resource operation succeeds. If a
     * removal fails, active metadata remains the source of truth instead of
     * falsely reporting a terminal task. */
    await archiveTask(root, record, terminalState, options.cleanupActor ?? options.agent, options.cleanupReason, now);
    await fs.rm(await taskFilePath(root, options.taskId, record.target), { force: true });
    return terminalState;
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
    if (record.branch || record.worktree || record.worktreesRoot) {
      throw new Error(`release bloqueado: ${options.taskId} conserva recursos; ejecuta cleanup o recuperación`);
    }
    const now = options.now ?? Date.now();
    appendTaskEvent(record, { now, actor: options.agent, action: 'RELEASE', fromState: record.state, toState: 'RELEASED' });
    await archiveTask(root, record, 'RELEASED', options.agent, 'release explícito', now);
    await fs.rm(await taskFilePath(root, options.taskId, record.target), { force: true });
  });
}

async function registeredTaskWorktrees(root: string, branchPrefixes: string[]): Promise<{ paths: Set<string>; branches: Set<string> }> {
  const output = await git(root, ['worktree', 'list', '--porcelain']);
  const paths = new Set<string>();
  const branches = new Set<string>();
  let worktree: string | null = null;
  let branch: string | null = null;
  const flush = () => {
    if (worktree && branch && branchPrefixes.some(prefix => branch!.startsWith(`${prefix}/`))) {
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

export async function recordTaskGateRun(options: TaskCoordinatorOptions & { mode: 'local' | 'full' | 'ci'; status: 'PASS' | 'FAIL' | 'ERROR'; exitCode: number; reportPath?: string }): Promise<void> {
  const root = rootOf(options.projectRoot);
  const primaryBranch = requiredPrimaryBranch(options);
  await withTaskLock(root, options.taskId, primaryBranch, async () => {
    const record = await readTask(root, options.taskId, primaryBranch);
    if (!record) throw new Error(`tarea ${options.taskId} no está tomada`);
    if (record.agent !== options.agent) throw new Error(`tarea ${options.taskId} pertenece a ${record.agent}`);
    const now = options.now ?? Date.now();
    record.gateRuns = [...(record.gateRuns ?? []), {
      at: new Date(now).toISOString(),
      actor: options.agent,
      mode: options.mode,
      status: options.status,
      exitCode: options.exitCode,
      ...(options.reportPath ? { reportPath: safeRelativeReference(options.reportPath, 'reportPath') ?? undefined } : {}),
    }].slice(-50);
    appendTaskEvent(record, { now, actor: options.agent, action: 'GATE', fromState: record.state, toState: record.state, exitCode: options.exitCode, result: options.status });
    record.updatedAt = new Date(now).toISOString();
    record.updatedAtMs = now;
    await writeTask(root, record);
  });
}

export async function taskStatus(projectRoot: string, primaryBranch: string, includeAll = false): Promise<TaskStatusResult> {
  const root = rootOf(projectRoot);
  const normalizedPrimaryBranch = sanitizeBranch(primaryBranch);
  const directory = await coordinatorDir(root, normalizedPrimaryBranch);
  const tasks: TaskStatusRecord[] = [];
  const history: TaskHistoryRecord[] = [];
  const invalidMetadata: string[] = [];
  const legacyOrphans: TaskLegacyOrphan[] = [];
  const statusCommonDir = await gitCommonDir(root);
  const coordinationRoot = path.dirname(directory);
  let identityDirectories = [path.basename(directory)];
  if (includeAll) {
    try {
      identityDirectories = (await fs.readdir(coordinationRoot, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      identityDirectories = [];
    }
  }
  for (const identityDirectory of identityDirectories) {
    const activeDirectory = path.join(coordinationRoot, identityDirectory);
    let names: string[] = [];
    try { names = (await fs.readdir(activeDirectory)).filter(name => name.endsWith('.json')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const name of names) {
      try {
        const value: unknown = JSON.parse(await fs.readFile(path.join(activeDirectory, name), 'utf8'));
        const normalized = normalizeTaskRecord(value);
        if (!normalized) {
          const legacy = value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null;
          if (legacy && (legacy.schemaVersion === 1 || legacy.schemaVersion === 2)
            && typeof legacy.taskId === 'string' && SAFE_TASK_ID.test(legacy.taskId)) {
            legacyOrphans.push({
              metadataPath: includeAll ? `${identityDirectory}/${name}` : name,
              taskId: legacy.taskId,
              target: typeof legacy.target === 'string' ? legacy.target : null,
              branch: typeof legacy.branch === 'string' ? legacy.branch : null,
              worktree: typeof legacy.worktree === 'string' ? legacy.worktree : null,
              reason: 'metadata legacy no cumple el esquema actual; requiere revisión/adopción explícita',
            });
            continue;
          }
          throw new Error('schema inválido');
        }
        /* status es diagnóstico: no debe mutar metadata legacy solo por leerla.
         * Una metadata v1/v2 de otra rama/namespace no se convierte en tarea
         * activa: se expone como legacyOrphan para revisión/adopción explícita. */
        const taskIdentity = projectIdentity(statusCommonDir, normalized.record.target);
        const expectedCurrentBranch = branchFor(normalized.record.taskId, projectIdentity(statusCommonDir, normalizedPrimaryBranch));
        const legacyNamespaceMismatch = normalized.migrated && (
          normalized.record.target !== normalizedPrimaryBranch
          || (normalized.record.branch !== null && normalized.record.branch !== expectedCurrentBranch)
        );
        if (legacyNamespaceMismatch) {
          legacyOrphans.push({
            metadataPath: includeAll ? `${identityDirectory}/${name}` : name,
            taskId: normalized.record.taskId,
            target: normalized.record.target ?? null,
            branch: normalized.record.branch,
            worktree: normalized.record.worktree,
            reason: 'metadata legacy pertenece a otra rama o namespace; requiere adopción/revisión explícita',
          });
          continue;
        }
        const safeWorktree = normalized.record.worktree
          ? await resolveWorktreePath(root, normalized.record.worktree, statusCommonDir, normalized.record.taskId, taskIdentity, normalized.record.worktreesRoot ?? undefined)
          : null;
        const [alive, clean] = await Promise.all([processAlive(normalized.record), worktreeClean(safeWorktree?.worktree ?? null)]);
        tasks.push({
          ...normalized.record,
          expired: stale(normalized.record, Date.now()),
          processAlive: alive,
          worktreeClean: clean,
        });
      } catch { invalidMetadata.push(includeAll ? `${identityDirectory}/${name}` : name); }
    }
  }
  if (includeAll) {
    const historyRoot = path.join(directory, '..', '..', 'history');
    try {
      let historyFilesRead = 0;
      for (const identity of await fs.readdir(historyRoot)) {
        if (!SAFE_PROJECT_IDENTITY.test(identity)) continue;
        const identityRoot = path.join(historyRoot, identity);
        for (const name of await fs.readdir(identityRoot)) {
          if (!name.endsWith('.json')) continue;
          if (++historyFilesRead > MAX_HISTORY_FILES) {
            invalidMetadata.push(`history: límite de ${MAX_HISTORY_FILES} archivos alcanzado`);
            break;
          }
          try {
            const archived = JSON.parse(await fs.readFile(path.join(identityRoot, name), 'utf8')) as Partial<TaskHistoryRecord>;
            const validArchive = archived.archiveSchemaVersion === 1
              && typeof archived.taskId === 'string' && SAFE_TASK_ID.test(archived.taskId)
              && typeof archived.projectIdentity === 'string' && SAFE_PROJECT_IDENTITY.test(archived.projectIdentity)
              && ['CLEANED', 'RELEASED', 'RECOVERED'].includes(archived.terminalState ?? '')
              && typeof archived.archivedAt === 'string'
              && typeof archived.archivedBy === 'string' && SAFE_AGENT.test(archived.archivedBy)
              && Boolean(archived.record) && validTaskRecord(archived.record)
              && archived.record.taskId === archived.taskId
              && archived.projectIdentity === projectIdentity(statusCommonDir, archived.record.target);
            if (!validArchive) throw new Error('historial inválido');
            history.push(archived as TaskHistoryRecord);
          } catch { invalidMetadata.push(`history/${identity}/${name}`); }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const knownPaths = new Set(tasks.map(task => task.worktree).filter((value): value is string => Boolean(value)).map(value => path.resolve(value)));
  const knownBranches = new Set(tasks.map(task => task.branch).filter((value): value is string => Boolean(value)));
  const commonDir = statusCommonDir;
  const identities = includeAll
    ? identityDirectories.filter(identity => SAFE_PROJECT_IDENTITY.test(identity))
    : [projectIdentity(commonDir, normalizedPrimaryBranch)];
  const branchPrefixes = identities.map(taskBranchPrefix);
  const allTaskBranches = await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/task/']);
  const discoveredPrefixes = allTaskBranches
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(branch => branch.split('/').slice(0, 2).join('/'))
    .filter(prefix => /^task\/[a-f0-9]{16}$/u.test(prefix));
  const allPrefixes = [...new Set([...branchPrefixes, ...discoveredPrefixes])];
  const registered = await registeredTaskWorktrees(root, allPrefixes);
  const branches = (await Promise.all(allPrefixes.map(prefix => git(root, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}/`]))) )
    .flatMap(output => output.split(/\r?\n/u).filter(Boolean));
  let locks: string[] = [];
  try {
    locks = (await fs.readdir(directory)).filter(name => name.endsWith('.lock'));
  } catch { /* la ausencia del directorio ya equivale a cero locks */ }
  const expiredLocks: string[] = [];
  for (const lock of locks) {
    try { if (Date.now() - (await fs.stat(path.join(directory, lock))).mtimeMs > OPERATION_LOCK_TTL_MS) expiredLocks.push(lock); }
    catch { /* desapareció durante status */ }
  }
  const physicalOrphanWorktrees: string[] = [];
  const physicalRoots = new Set<string>([path.resolve(path.dirname(directory), '..', 'worktrees')]);
  for (const task of tasks) {
    if (task.worktreesRoot) physicalRoots.add(path.resolve(task.worktreesRoot));
  }
  for (const archived of history) {
    if (archived.record.worktreesRoot) physicalRoots.add(path.resolve(archived.record.worktreesRoot));
  }
  for (const physicalRoot of physicalRoots) {
    try {
      for (const name of await fs.readdir(physicalRoot)) {
        const candidate = path.resolve(physicalRoot, name);
        if (knownPaths.has(candidate)) continue;
        try {
          const stat = await fs.lstat(candidate);
          if (stat.isDirectory() || stat.isSymbolicLink()) physicalOrphanWorktrees.push(candidate);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return {
    tasks,
    invalidMetadata,
    legacyOrphans,
    orphanWorktrees: [...registered.paths].filter(value => !knownPaths.has(value)),
    orphanBranches: branches.filter(value => !knownBranches.has(value)),
    expiredLocks,
    history: history.sort((a, b) => a.archivedAt.localeCompare(b.archivedAt)),
    physicalOrphanWorktrees,
  };
}
