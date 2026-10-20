/* [108A-1 Fase 2] Dispatch del CLI único de Sentinel: runCli enruta cada
 * comando a su handler. Los handlers viven en comandos/cli*.ts y el parsing en
 * ./args; commands.ts solo re-exporta este módulo para el contrato de '../../cli'. */
import * as path from 'path';
import { cancelAll } from '../core/runtime-proyecto/toolRunner';
import { CheckRunResult } from '../core/gate/gateRun';
import { diagnoseWorkspace, formatDiagnose, formatStatus } from '../core/diagnostico/diagnose';
import { formatShims } from '../core/shims/shimDiagnostics';
import { formatRuntimeResult } from '../core/runtime-proyecto/runtimeInstall';
import {
  defaultProfilePaths,
  formatPathEntryResult,
  formatProfilesResult,
  installPathEntry,
  installProfiles,
  uninstallPathEntry,
  writeInterceptorShims,
} from '../core/shims/interceptorShims';
import { parseCliArgs, usage, TaskCliArgs } from './args';
import { AyudaSolicitada } from './parseo/argsUsage';
import { analyzeCliTarget, renderOutput } from './comandos/cliAnalyze';
import { checkCliTarget, taskCliTarget } from './comandos/cliGate';
import { leaseCliTarget } from './comandos/cliLease';
import { guardCliTarget, installCliTarget, rollbackCliTarget, uninstallCliTarget } from './comandos/cliRuntime';
import { readConfig, readPackageVersion, writeOrPrint } from './comandos/cliShared';
import { initCliTarget, migrateCliTarget, uninitCliTarget } from './bootstrapCommands';

export async function runCli(rawArgs: string[]): Promise<number> {
  /* [085A-3] CLI real de reportes sobre el core editor-agnostico.
   * Gotcha: los smoke tests deben ejecutar el JS compilado porque los mocks unitarios de VS Code pueden ocultar imports indirectos de `vscode` en Node puro.
   * Pendiente: agregar fixtures de equivalencia CLI/core en Fase 4. */
  if (rawArgs.length === 1 && (rawArgs[0] === '--help' || rawArgs[0] === '-h')) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (rawArgs.length === 1 && rawArgs[0] === '--version') {
    process.stdout.write(`${await readPackageVersion()}\n`);
    return 0;
  }

  let args: ReturnType<typeof parseCliArgs>;
  try {
    args = parseCliArgs(rawArgs);
  } catch (error) {
    /* `--help` de un subcomando: imprime el uso y sale con 0, como el --help global. */
    if (!(error instanceof AyudaSolicitada)) throw error;
    process.stdout.write(`${error.message}\n`);
    return 0;
  }
  if (args.command === 'task') {
    const taskArgs = args as unknown as TaskCliArgs;
    const config = await readConfig(undefined, taskArgs.workspacePath);
    const configuredBranch = config.project?.primaryBranch;
    taskArgs.primaryBranch ??= configuredBranch;
    taskArgs.base ??= taskArgs.primaryBranch;
    taskArgs.target ??= taskArgs.primaryBranch;
    const execution = await taskCliTarget(taskArgs);
    await writeOrPrint(execution.output, taskArgs.outputPath);
    return execution.exitCode;
  }
  if (args.command === 'check') {
    /* [028A-6] En una ejecución real, Ctrl+C/SIGTERM debe terminar también
     * los hijos del gate (cancelAll), no dejarlos huérfanos. */
    const onSignal = () => cancelAll();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    let result: CheckRunResult;
    try {
      result = await checkCliTarget(args);
    } finally {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
    await writeOrPrint(result.output, args.outputPath);
    return result.exitCode;
  }
  if (args.command === 'guard') {
    return guardCliTarget(args);
  }
  if (args.command === 'uninstall') {
    /* [028A-6 Fase 5] La desinstalación solo retira entradas administradas
     * (PATH, perfiles, shims y opcionalmente runtime). Un 'error' de PATH o
     * perfiles propaga exit != 0 para que el wrapper del repo no declare una
     * retirada completa sobre una integración a medio retirar. */
    const result = await uninstallCliTarget(args);
    const failed = result.pathEntry.action === 'error'
      || result.profiles.some(profile => profile.action === 'error')
      || result.errors.length > 0;
    const output = args.json ? `${JSON.stringify(result, null, 2)}\n` : formatRuntimeResult(result);
    await writeOrPrint(output, args.outputPath);
    return failed ? 1 : 0;
  }
  if (args.command === 'install' || args.command === 'update' || args.command === 'rollback') {
    if (args.command === 'rollback') {
      const result = await rollbackCliTarget(args);
      const output = args.json ? `${JSON.stringify(result, null, 2)}\n` : formatRuntimeResult(result);
      await writeOrPrint(output, args.outputPath);
      /* [por que] Un rollback que no restaura nada (sin versión anterior o sin hash verificado)
       * debe salir con fallo: con 0 el script que lo llame creería que la versión volvió. */
      return !result.dryRun && !result.restoredVersion ? 1 : 0;
    }
    const result = await installCliTarget(args);
    const targetRoot = result.targetRoot;
    const chunks: string[] = [args.json ? JSON.stringify(result, null, 2) : formatRuntimeResult(result)];
    /* [028A-6] Un error de perfiles o PATH (permiso, disco, perfil corrupto)
     * hace fallar el install con exit != 0 para que el instalador del repo
     * no declare "migración completa" sobre una integración rota. */
    let installFailed = false;
    /* [028A-6 Fase 1] Shims interceptores y dot-source en perfiles son
     * operaciones explícitas: solo se ejecutan con --with-shims /
     * --with-profiles y solo tras instalar la versión (no en dry-run ni en
     * rollback). Los perfiles se tocan SIEMPRE con backup previo. */
    /* [028A-6 Fase 3] --with-path expone los shims en el PATH de usuario;
     * implica escribir los shims aunque no se pase --with-shims (una entrada
     * de PATH que apunta a un directorio inexistente rompería npm/cargo). */
    const wantShims = args.withShims || args.withPath;
    if (wantShims && !args.dryRun) {
      const shims = await writeInterceptorShims(targetRoot);
      if (args.json) chunks.push(JSON.stringify({ shims }, null, 2));
      else chunks.push(`Shims interceptores: ${shims.files.join(', ')}`);
    }
    if (args.withProfiles && !args.dryRun) {
      const profilesResult = await installProfiles({
        shimDir: path.join(targetRoot, 'shims'),
        profiles: defaultProfilePaths(),
      });
      if (args.json) chunks.push(JSON.stringify(profilesResult, null, 2));
      else chunks.push(formatProfilesResult(profilesResult));
      /* [028A-6] Un perfil con error (permiso, disco, perfil corrupto) es un
       * fallo de instalación real: el instalador del repo depende del exit
       * code para no declarar "migración completa" sobre una integración
       * rota. En dry-run nunca hay errores de escritura. */
      if (profilesResult.profiles.some(profile => profile.action === 'error')) installFailed = true;
    }
    if (args.withPath) {
      const pathResult = await installPathEntry(targetRoot, { dryRun: args.dryRun });
      if (args.json) chunks.push(JSON.stringify(pathResult, null, 2));
      else chunks.push(formatPathEntryResult(pathResult));
      if (pathResult.action === 'error') installFailed = true;
    }
    if (args.withoutPath) {
      const pathResult = await uninstallPathEntry(targetRoot, { dryRun: args.dryRun });
      if (args.json) chunks.push(JSON.stringify(pathResult, null, 2));
      else chunks.push(formatPathEntryResult(pathResult));
      if (pathResult.action === 'error') installFailed = true;
    }
    await writeOrPrint(chunks.join('\n'), args.outputPath);
    return installFailed ? 1 : 0;
  }
  if (args.command === 'doctor' || args.command === 'status') {
    const workspace = path.resolve(args.workspacePath ?? process.cwd());
    const diagnosis = await diagnoseWorkspace(workspace);
    /* [108A-1 F6] `doctor --shims`: salida enfocada en qué ejecutable gana
     * realmente en PATH para node/npm/npx/cargo (marcando shims del guard). */
    const output = args.json
      ? `${JSON.stringify(diagnosis, null, 2)}\n`
      : args.command === 'doctor' && args.doctorShims
        ? `${formatShims(diagnosis.shims)}\n`
        : `${(args.command === 'doctor' ? formatDiagnose(diagnosis) : formatStatus(diagnosis))}\n`;
    await writeOrPrint(output, args.outputPath);
    /* Doctor es preflight fail-closed: una capacidad ausente, checkout dirty,
     * lock divergente o release no publicada debe producir exit != 0 antes de
     * que un gate/instalador intente ejecutar etapas. `status` sigue siendo
     * observabilidad read-only y conserva exit 0. */
    return args.command === 'doctor' && !diagnosis.ready ? 1 : 0;
  }
  if (args.command === 'lease') {
    const { output, exitCode } = await leaseCliTarget(args);
    await writeOrPrint(output, args.outputPath);
    return exitCode;
  }
  if (args.command === 'init') {
    const result = await initCliTarget(args, await readPackageVersion());
    await writeOrPrint(result.output, args.outputPath);
    return result.exitCode;
  }
  if (args.command === 'migrate') {
    const output = await migrateCliTarget(args);
    await writeOrPrint(output, args.outputPath);
    return 0;
  }
  if (args.command === 'uninit') {
    const result = await uninitCliTarget(args);
    await writeOrPrint(result.output, args.outputPath);
    return result.exitCode;
  }
  const result = await analyzeCliTarget(args);
  await writeOrPrint(renderOutput(result, args, await readPackageVersion()), args.outputPath);
  return result.hasErrors ? 1 : 0;
}
