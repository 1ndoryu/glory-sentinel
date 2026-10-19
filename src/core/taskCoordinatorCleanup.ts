import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { validateIgnoredInputs } from './envManifest';
import { TaskCoordinatorOptions, TaskRecord, TaskTerminalState } from './taskCoordinatorTypes';
import { appendTaskEvent, requiredPrimaryBranch } from './taskCoordinatorValidacion';
import { branchExists, branchFor, exists, git, gitCommonDir, gitStatus, projectIdentity, registeredWorktreeFor, resolveWorktreePath, rootOf, taskFilePath } from './taskCoordinatorRutas';
import { readTask, stale, withTaskLock } from './taskCoordinatorAlmacen';
import { archiveTask } from './taskCoordinatorRegistros';

export async function processAlive(record: TaskRecord): Promise<boolean> {
  if (record.host !== os.hostname() || !Number.isInteger(record.pid) || record.pid <= 0) return false;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export async function worktreeClean(worktree: string | null): Promise<boolean | null> {
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

export async function registeredTaskWorktrees(root: string, branchPrefixes: string[]): Promise<{ paths: Set<string>; branches: Set<string> }> {
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
