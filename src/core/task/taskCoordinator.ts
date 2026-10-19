/* [028A-18] Coordinador universal de tareas para Sentinel.
 * La unidad de paralelismo es una tarea por rama/worktree. El estado efímero
 * vive junto al Git común y los worktrees temporales dentro de la raíz del
 * repositorio, nunca fuera del checkout del consumidor. */

export { TASK_COORDINATOR_SCHEMA_VERSION, TASK_TTL_MS } from './coordinador/taskCoordinatorTypes';
export type { TaskCoordinatorOptions, TaskEvent, TaskGateRun, TaskHistoryRecord, TaskLegacyOrphan, TaskRecord, TaskState, TaskStatusRecord, TaskStatusResult, TaskTerminalState } from './coordinador/taskCoordinatorTypes';
export { sanitizeAgent, sanitizeBranch, sanitizeTaskId } from './coordinador/taskCoordinatorValidacion';
export { claimTask, heartbeatTask, integrateTask, startTask, verifyTaskWorktree } from './coordinador/taskCoordinatorLifecycle';
export { cleanupTask, releaseTask } from './coordinador/taskCoordinatorCleanup';
export { recordTaskGateRun, taskStatus } from './coordinador/taskCoordinatorEstado';
