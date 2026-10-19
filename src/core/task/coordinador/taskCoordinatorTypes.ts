import { IgnoredBaselineSnapshot, IgnoredInputSnapshot } from '../../runtime-proyecto/envManifest';

export const TASK_COORDINATOR_SCHEMA_VERSION = 3;
export const TASK_TTL_MS = 6 * 60 * 60 * 1000;
export const OPERATION_LOCK_TTL_MS = 30 * 60 * 1000;
export const LOCK_REFRESH_MS = 60 * 1000;

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
