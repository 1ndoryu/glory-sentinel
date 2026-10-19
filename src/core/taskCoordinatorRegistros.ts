import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { writeAtomic } from './atomicFile';
import { isSafeBranch } from './branchValidation';
import { TASK_COORDINATOR_SCHEMA_VERSION, TaskCoordinatorOptions, TaskEvent, TaskGateRun, TaskHistoryRecord, TaskRecord, TaskState, TaskTerminalState } from './taskCoordinatorTypes';
import { MAX_HISTORY_EVENTS, MAX_TEXT, SAFE_AGENT, SAFE_TASK_ID, appendTaskEvent, boundedText, eventId, requiredPrimaryBranch, safeRelativeReference, sanitizeAgent, sanitizeBranch, sanitizeTaskId } from './taskCoordinatorValidacion';
import { coordinatorDir, git, gitCommonDir, projectIdentity } from './taskCoordinatorRutas';

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

export function validTaskRecord(value: unknown): value is TaskRecord {
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

export function normalizeTaskRecord(value: unknown): { record: TaskRecord; migrated: boolean } | null {
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

export function createRecord(options: TaskCoordinatorOptions): TaskRecord {
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

export async function archiveTask(root: string, record: TaskRecord, terminalState: TaskTerminalState, actor: string, reason?: string, now = Date.now()): Promise<void> {
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

export async function collectTaskEvidence(worktree: string, baseHead: string | null, head: string): Promise<{ commits: string[]; changedFiles: string[] }> {
  if (!baseHead) return { commits: [head], changedFiles: [] };
  const commits = (await git(worktree, ['log', '--format=%H', `${baseHead}..${head}`])).split(/\\r?\\n/u).filter(Boolean);
  const changedFiles = (await git(worktree, ['diff', '--name-only', `${baseHead}..${head}`])).split(/\\r?\\n/u).filter(Boolean).map(value => value.replace(/\\/gu, '/'));
  return { commits, changedFiles };
}
