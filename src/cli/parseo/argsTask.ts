/* [108A-1 Fase 2] Parser del subcomando `sentinel task` y formato de su salida.
 * Separado de args.ts para mantener cada módulo bajo el límite de líneas. */
import type { TaskAction, TaskCliArgs, TaskCliResult } from './argsTypes';
import { taskUsage } from './argsUsage';
import { takeValue } from './argsValue';

export function formatTaskResult(result: TaskCliResult, json = false): string {
  if (json) return `${JSON.stringify(result, null, 2)}\n`;
  const lines = Object.entries(result).map(([key, value]) => `  ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return `${lines.join('\n')}\n`;
}

export function parseTaskCliArgs(args: string[]): TaskCliArgs {
  const action = args[1];
  if (!['claim', 'start', 'heartbeat', 'status', 'gate', 'integrate', 'cleanup', 'release', 'recover'].includes(action ?? '')) {
    throw new Error(`${taskUsage()}`);
  }
  const parsed: TaskCliArgs = { command: 'task', taskAction: action as TaskAction, json: false };
  let positionalId = false;
  for (let index = 2; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--') && !positionalId) {
      parsed.taskId = arg;
      positionalId = true;
    } else if (arg === '--project-root' || arg === '--workspace') {
      parsed.workspacePath = takeValue(args, index, arg);
      index++;
    } else if (arg === '--agent') {
      parsed.agent = takeValue(args, index, arg);
      index++;
    } else if (arg === '--base' || arg === '--primary-branch') {
      parsed.primaryBranch = takeValue(args, index, arg);
      parsed.base = parsed.primaryBranch;
      index++;
    } else if (arg === '--target') {
      parsed.target = takeValue(args, index, arg);
      index++;
    } else if (arg === '--path') {
      parsed.worktreePath = takeValue(args, index, arg);
      index++;
    } else if (arg === '--worktrees-root') {
      parsed.worktreesRoot = takeValue(args, index, arg);
      index++;
    } else if (arg === '--env-manifest') {
      parsed.envManifestPath = takeValue(args, index, arg);
      index++;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--full') {
      parsed.full = true;
    } else if (arg === '--ci') {
      parsed.ci = true;
    } else if (arg === '--allow-heavy') {
      parsed.allowHeavy = true;
    } else if (arg === '--stages') {
      parsed.stagesPath = takeValue(args, index, arg);
      index++;
    } else if (arg === '--summary') {
      parsed.summary = takeValue(args, index, arg);
      index++;
    } else if (arg === '--plan') {
      parsed.planReference = takeValue(args, index, arg);
      index++;
    } else if (arg === '--related-task') {
      parsed.relatedTaskIds = [...(parsed.relatedTaskIds ?? []), takeValue(args, index, arg)];
      index++;
    } else if (arg === '--all') {
      parsed.all = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--output') {
      parsed.outputPath = takeValue(args, index, arg);
      index++;
    } else if (arg === '--help' || arg === '-h') {
      throw new Error(taskUsage());
    } else {
      throw new Error(`Opcion no reconocida: ${arg}\\n${taskUsage()}`);
    }
  }
  if (parsed.taskAction !== 'status' && !parsed.taskId) throw new Error(`task ${parsed.taskAction} requiere <id>`);
  if (parsed.taskAction !== 'status' && !parsed.agent) throw new Error(`task ${parsed.taskAction} requiere --agent`);
  parsed.workspacePath ??= process.cwd();
  return parsed;
}
