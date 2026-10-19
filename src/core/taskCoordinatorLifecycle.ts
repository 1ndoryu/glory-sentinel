import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MissingTaskInputError, provisionTaskInputs, resolveEnvManifestPath, validateIgnoredInputs } from './envManifest';
import { TaskCoordinatorOptions, TaskRecord } from './taskCoordinatorTypes';
import { appendTaskEvent, requiredPrimaryBranch, sanitizeAgent, sanitizeBranch, sanitizeTaskId } from './taskCoordinatorValidacion';
import { branchExists, branchFor, exists, git, gitCommonDir, gitStatus, projectIdentity, registeredWorktreeFor, resolveWorktreePath, rootOf, taskFilePath } from './taskCoordinatorRutas';
import { hasCaseInsensitiveTaskConflict, readTask, stale, withLock, withTaskLock, writeTask } from './taskCoordinatorAlmacen';
import { collectTaskEvidence, createRecord } from './taskCoordinatorRegistros';

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
