/* [108A-1 Fase 2] Comandos de runtime y diagnóstico: guard, install/update,
 * rollback, uninstall y doctor/status. Devuelven resultados; runCli escribe la salida. */
import * as path from 'path';
import { runGuardCommand } from '../../core/guard/guardEntry';
import { diagnoseWorkspace, formatDiagnose, formatStatus } from '../../core/diagnostico/diagnose';
import {
  installRuntime,
  rollbackRuntime,
  uninstallRuntime,
  RuntimeInstallResult,
  RuntimeRollbackResult,
  RuntimeUninstallResult,
} from '../../core/runtime-proyecto/runtimeInstall';
import { ParsedCliArgs } from '../parseo/argsTypes';

export async function guardCliTarget(args: ParsedCliArgs): Promise<number> {
  return runGuardCommand({
    executable: args.guardExecutable ?? '',
    args: args.guardArgs ?? [],
    cwd: args.workspacePath ?? process.cwd(),
    projectRoot: args.guardProjectRoot,
    json: args.json,
  });
}

export async function installCliTarget(args: ParsedCliArgs): Promise<RuntimeInstallResult> {
  return installRuntime({
    targetRoot: args.targetRoot,
    sourceRoot: args.sourceRoot,
    version: args.runtimeVersion,
    dryRun: args.dryRun,
    /* [028A-6] El contrato exige un runtime autónomo: el artefacto incluye
     * sus dependencias (node_modules) para no depender del checkout. */
    includeDependencies: true,
  });
}

export async function rollbackCliTarget(args: ParsedCliArgs): Promise<RuntimeRollbackResult> {
  return rollbackRuntime({
    targetRoot: args.targetRoot,
    version: args.runtimeVersion,
    dryRun: args.dryRun,
  });
}

export async function uninstallCliTarget(args: ParsedCliArgs): Promise<RuntimeUninstallResult> {
  return uninstallRuntime({
    targetRoot: args.targetRoot,
    dryRun: args.dryRun,
    keepRuntime: args.keepRuntime,
  });
}

export async function diagnoseCliTarget(args: ParsedCliArgs, command: 'doctor' | 'status'): Promise<string> {
  const result = await diagnoseWorkspace(path.resolve(args.workspacePath ?? process.cwd()));
  return args.json
    ? `${JSON.stringify(result, null, 2)}\n`
    : `${(command === 'doctor' ? formatDiagnose(result) : formatStatus(result))}\n`;
}
