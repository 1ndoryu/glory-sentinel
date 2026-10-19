import * as fs from 'fs/promises';
import * as path from 'path';
import { OPERATION_LOCK_TTL_MS, TaskCoordinatorOptions, TaskHistoryRecord, TaskLegacyOrphan, TaskStatusRecord, TaskStatusResult } from './taskCoordinatorTypes';
import { MAX_HISTORY_FILES, SAFE_AGENT, SAFE_PROJECT_IDENTITY, SAFE_TASK_ID, appendTaskEvent, requiredPrimaryBranch, safeRelativeReference, sanitizeBranch } from './taskCoordinatorValidacion';
import { branchFor, coordinatorDir, git, gitCommonDir, projectIdentity, resolveWorktreePath, rootOf, taskBranchPrefix } from './taskCoordinatorRutas';
import { readTask, stale, withTaskLock, writeTask } from './taskCoordinatorAlmacen';
import { normalizeTaskRecord, validTaskRecord } from './taskCoordinatorRegistros';
import { processAlive, registeredTaskWorktrees, worktreeClean } from './taskCoordinatorCleanup';

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
