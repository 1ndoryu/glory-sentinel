/* [SNT-16d] Recuperación explícita de tareas interrumpidas.
 * La recuperación nunca toma una tarea activa, no borra un proceso vivo y
 * delega el cleanup real al coordinador, que vuelve a validar namespace,
 * worktree, rama y suciedad antes de eliminar recursos. */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  cleanupTask,
  sanitizeTaskId,
  taskStatus,
  TASK_TTL_MS,
  TaskRecord,
} from './taskCoordinator';

const execFileAsync = promisify(execFile);
const SAFE_AGENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export interface TaskRecoveryOptions {
  projectRoot: string;
  primaryBranch: string;
  taskId: string;
  recoveredBy: string;
  dryRun?: boolean;
  now?: number;
}

export interface TaskRecoveryResult {
  taskId: string;
  state: 'DRY_RUN' | 'RECOVERED';
  recoveredBy: string;
  previousAgent: string;
  previousState: TaskRecord['state'];
  staleForMs: number;
  worktree: string | null;
  worktreeClean: boolean | null;
}

function processAlive(record: TaskRecord): boolean {
  if (record.host !== os.hostname() || !Number.isInteger(record.pid) || record.pid <= 0) return false;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function insideWorktreeRoot(projectRoot: string, candidate: string): boolean {
  const root = path.resolve(projectRoot, '.sentinel', 'worktrees');
  const relative = path.relative(root, path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function gitRevision(cwd: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', ref], {
      cwd,
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function inspectWorktree(projectRoot: string, worktree: string | null): Promise<boolean | null> {
  if (!worktree) return null;
  if (!insideWorktreeRoot(projectRoot, worktree)) {
    throw new Error(`recover bloqueado: worktree fuera de .sentinel/worktrees (${worktree})`);
  }
  try {
    const canonical = await fs.realpath(worktree);
    if (!insideWorktreeRoot(projectRoot, canonical)) {
      throw new Error(`recover bloqueado: worktree físico fuera de .sentinel/worktrees (${worktree})`);
    }
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: canonical,
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim().length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function verifyRecordedHeads(projectRoot: string, record: TaskRecord): Promise<void> {
  if (!record.branch || !record.head) {
    if (record.worktree) throw new Error(`recover bloqueado: metadata incompleta para ${record.taskId}`);
    return;
  }
  const branchHead = await gitRevision(projectRoot, record.branch);
  if (!branchHead) throw new Error(`recover bloqueado: no existe la rama registrada ${record.branch}`);
  if (branchHead !== record.head) {
    throw new Error(`recover bloqueado: la rama ${record.branch} avanzó desde el último heartbeat`);
  }
  if (record.worktree) {
    const canonical = await fs.realpath(record.worktree).catch(() => null);
    if (canonical) {
      const worktreeHead = await gitRevision(canonical, 'HEAD');
      if (worktreeHead !== record.head) {
        throw new Error(`recover bloqueado: el worktree no coincide con el HEAD registrado`);
      }
    }
  }
}

async function writeRecoveryAudit(projectRoot: string, result: TaskRecoveryResult, now: number): Promise<void> {
  const directory = path.join(path.resolve(projectRoot), '.sentinel', 'recovery');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${sanitizeTaskId(result.taskId)}-${now}.json`);
  await fs.writeFile(file, `${JSON.stringify({
    schemaVersion: 1,
    taskId: result.taskId,
    recoveredBy: result.recoveredBy,
    previousAgent: result.previousAgent,
    previousState: result.previousState,
    staleForMs: result.staleForMs,
    worktree: result.worktree,
    worktreeClean: result.worktreeClean,
    state: result.state,
    at: new Date(now).toISOString(),
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

export async function recoverTask(options: TaskRecoveryOptions): Promise<TaskRecoveryResult> {
  sanitizeTaskId(options.taskId);
  if (!options.recoveredBy || !SAFE_AGENT.test(options.recoveredBy)) {
    throw new Error(`recoveredBy inválido: ${options.recoveredBy}`);
  }
  const now = options.now ?? Date.now();
  const status = await taskStatus(options.projectRoot, options.primaryBranch);
  const record = status.tasks.find(item => item.taskId === options.taskId);
  if (!record) throw new Error(`recover: no existe la tarea ${options.taskId}`);
  if (record.state === 'INTEGRATED') throw new Error(`recover bloqueado: ${options.taskId} ya está integrada; usa cleanup`);
  const staleForMs = now - record.updatedAtMs;
  if (staleForMs <= TASK_TTL_MS) {
    throw new Error(`recover bloqueado: ${options.taskId} no está expirada (${Math.max(0, staleForMs)} ms)`);
  }
  if (processAlive(record)) {
    throw new Error(`recover bloqueado: el proceso ${record.pid} de ${options.taskId} sigue vivo`);
  }
  await verifyRecordedHeads(options.projectRoot, record);
  const worktreeClean = await inspectWorktree(options.projectRoot, record.worktree);
  if (worktreeClean === false) {
    throw new Error(`recover bloqueado: worktree sucio ${record.worktree}`);
  }
  const result: TaskRecoveryResult = {
    taskId: record.taskId,
    state: options.dryRun ? 'DRY_RUN' : 'RECOVERED',
    recoveredBy: options.recoveredBy,
    previousAgent: record.agent,
    previousState: record.state,
    staleForMs,
    worktree: record.worktree,
    worktreeClean,
  };
  if (options.dryRun) return result;
  await cleanupTask({
    projectRoot: options.projectRoot,
    primaryBranch: options.primaryBranch,
    taskId: record.taskId,
    agent: record.agent,
    force: true,
    now,
    expectedUpdatedAtMs: record.updatedAtMs,
    expectedPid: record.pid,
    expectedHead: record.head,
  });
  await writeRecoveryAudit(options.projectRoot, result, now);
  return result;
}
