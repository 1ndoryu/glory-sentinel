/* [108A-1 Fase 2] Comandos `check` (gate) y `task`. El gate de una tarea
 * reutiliza checkCliTarget, por eso viven en el mismo módulo. */
import * as path from 'path';
import { runCheck, CheckRunResult } from '../../core/gate/gateRun';
import {
  claimTask,
  cleanupTask,
  heartbeatTask,
  integrateTask,
  releaseTask,
  startTask,
  taskStatus,
  verifyTaskWorktree,
} from '../../core/task/taskCoordinator';
import { ParsedCliArgs, TaskCliArgs, TaskCliResult } from '../parseo/argsTypes';
import { formatTaskResult } from '../parseo/argsTask';
import { taskUsage } from '../parseo/argsUsage';
import { readConfig } from './cliShared';

export async function checkCliTarget(args: ParsedCliArgs): Promise<CheckRunResult> {
  const workspace = path.resolve(args.workspacePath ?? process.cwd());
  return runCheck({
    workspace,
    reportRoot: args.dryRun
      ? path.join(workspace, '.quality-reports', 'check-dry-run')
      : path.join(workspace, '.quality-reports', 'check', args.taskId ?? 'task'),
    dryRun: Boolean(args.dryRun),
    taskId: args.taskId,
    full: args.full,
    ci: args.ci,
    allowHeavy: args.allowHeavy,
    profile: args.profile,
    stagesPath: args.stagesPath,
  });
}

export interface TaskCliExecution {
  output: string;
  exitCode: number;
}

export async function taskCliTarget(args: TaskCliArgs): Promise<TaskCliExecution> {
  const workspace = path.resolve(args.workspacePath ?? process.cwd());
  const taskId = args.taskId ?? '';
  const agent = args.agent ?? '';
  const configuredBranch = (await readConfig(undefined, workspace)).project?.primaryBranch;
  const primaryBranch = args.primaryBranch ?? configuredBranch;
  let result: TaskCliResult;
  switch (args.taskAction) {
    case 'claim': result = { ...(await claimTask({ projectRoot: workspace, taskId, agent, force: args.force, target: args.target, primaryBranch, summary: args.summary, planReference: args.planReference, relatedTaskIds: args.relatedTaskIds })) }; break;
    case 'start': result = { ...(await startTask({ projectRoot: workspace, taskId, agent, base: args.base, target: args.target, primaryBranch, worktreePath: args.worktreePath, worktreesRoot: args.worktreesRoot, envManifestPath: args.envManifestPath })) }; break;
    case 'heartbeat': result = { ...(await heartbeatTask({ projectRoot: workspace, taskId, agent, primaryBranch })) }; break;
    case 'status': {
      if (!primaryBranch) throw new Error('task status requiere project.primaryBranch en sentinel.config.json');
      result = { ...(await taskStatus(workspace, primaryBranch, args.all)) };
      break;
    }
    case 'gate': {
      if (!primaryBranch) throw new Error('task gate requiere project.primaryBranch en sentinel.config.json');
      await verifyTaskWorktree({ projectRoot: workspace, taskId, agent, primaryBranch });
      await heartbeatTask({ projectRoot: workspace, taskId, agent, primaryBranch });
      const check = await checkCliTarget({
        command: 'check', format: 'markdown', workspacePath: workspace, taskId,
        full: args.full, ci: args.ci, allowHeavy: args.allowHeavy, stagesPath: args.stagesPath,
      });
      result = { taskId, gateExitCode: check.exitCode, output: check.output };
      break;
    }
    case 'integrate': result = { ...(await integrateTask({ projectRoot: workspace, taskId, agent, target: args.target, primaryBranch })) }; break;
    case 'cleanup': await cleanupTask({ projectRoot: workspace, taskId, agent, primaryBranch, force: args.force }); result = { taskId, state: 'CLEANED' }; break;
    case 'release': await releaseTask({ projectRoot: workspace, taskId, agent, primaryBranch }); result = { taskId, state: 'RELEASED' }; break;
    case 'recover': {
      if (!primaryBranch) throw new Error('task recover requiere project.primaryBranch en sentinel.config.json');
      const { recoverTask } = await import('../../core/task/taskRecovery');
      result = { ...(await recoverTask({ projectRoot: workspace, taskId, recoveredBy: agent, primaryBranch, dryRun: args.dryRun, worktreesRoot: args.worktreesRoot })) };
      break;
    }
    default: throw new Error(taskUsage());
  }
  return {
    output: args.taskAction === 'gate' && !args.json
      ? String(result.output ?? '')
      : formatTaskResult(result, args.json),
    exitCode: args.taskAction === 'gate' ? Number(result.gateExitCode ?? 0) : 0,
  };
}
