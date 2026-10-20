/* [108A-1 Fase 2] Parser de los demás comandos (analyze, check, guard, lease,
 * install/update/rollback/uninstall, init/migrate/uninit, doctor/status). El
 * despacho de `task` se delega en argsTask. */
import type { ParsedCliArgs } from './argsTypes';
import { parseTaskCliArgs } from './argsTask';
import { takeValue } from './argsValue';
import { AyudaSolicitada, usage } from './argsUsage';

/* Entero >= 0 para los límites de analyze; 0 significa sin límite. */
function parseLimite(valor: string, opcion: string): number {
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${opcion} debe ser un entero mayor o igual que 0 (0 = sin límite)`);
  return n;
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  if (args[0] === 'task') return parseTaskCliArgs(args) as unknown as ParsedCliArgs;
  if (!['analyze', 'check', 'guard', 'doctor', 'status', 'install', 'update', 'rollback', 'uninstall', 'lease', 'init', 'migrate', 'uninit'].includes(args[0] ?? '')) {
    throw new Error(usage());
  }

  /* La ayuda vale para cualquier comando y se pide antes de `--`, porque lo que
   * va detrás es para el ejecutable de `guard`. */
  const separador = args.indexOf('--');
  const opciones = separador === -1 ? args : args.slice(0, separador);
  if (opciones.includes('--help') || opciones.includes('-h')) throw new AyudaSolicitada(usage());

  const parsed: ParsedCliArgs = {
    command: args[0] as ParsedCliArgs['command'],
    format: 'markdown',
  };

  if (args[0] === 'guard') {
    const separator = args.indexOf('--');
    const before = args.slice(1, separator === -1 ? args.length : separator);
    parsed.guardArgs = separator === -1 ? [] : args.slice(separator + 1);
    for (let index = 0; index < before.length; index++) {
      const arg = before[index];
      if (arg === '--executable') {
        parsed.guardExecutable = takeValue(before, index, arg);
        index++;
      } else if (arg === '--project-root') {
        parsed.guardProjectRoot = takeValue(before, index, arg);
        index++;
      } else if (arg === '--json') {
        parsed.json = true;
      } else if (arg === '--workspace') {
        parsed.workspacePath = takeValue(before, index, arg);
        index++;
      } else {
        throw new Error(`Opcion no reconocida: ${arg}\n${usage()}`);
      }
    }
    return parsed;
  }

  if (args[0] === 'lease') {
    const action = args[1];
    if (!['issue', 'list', 'revoke', 'verify'].includes(action ?? '')) {
      throw new Error(`Acción lease no reconocida: ${String(action)}\n${usage()}`);
    }
    parsed.command = 'lease';
    parsed.leaseAction = action as ParsedCliArgs['leaseAction'];
    for (let index = 2; index < args.length; index++) {
      const arg = args[index];
      if (arg === '--project-root') {
        parsed.workspacePath = takeValue(args, index, arg);
        index++;
      } else if (arg === '--task-id') {
        parsed.taskId = takeValue(args, index, arg);
        index++;
      } else if (arg === '--command') {
        parsed.leaseCommand = takeValue(args, index, arg);
        index++;
      } else if (arg === '--lease') {
        parsed.leasePath = takeValue(args, index, arg);
        index++;
      } else if (arg === '--pid') {
        const pid = Number(takeValue(args, index, arg));
        if (!Number.isInteger(pid) || pid <= 0) throw new Error('--pid debe ser un PID válido');
        parsed.leasePid = pid;
        index++;
      } else if (arg === '--ttl-ms') {
        const ms = Number(takeValue(args, index, arg));
        if (!Number.isFinite(ms) || ms <= 0) throw new Error('--ttl-ms debe ser un entero positivo');
        parsed.leaseTtlMs = ms;
        index++;
      } else if (arg === '--json') {
        parsed.json = true;
      } else {
        throw new Error(`Opcion no reconocida: ${arg}\n${usage()}`);
      }
    }
    return parsed;
  }

  if (args[0] === 'install' || args[0] === 'update' || args[0] === 'rollback' || args[0] === 'uninstall') {
    for (let index = 1; index < args.length; index++) {
      const arg = args[index];
      if (arg === '--target-root') {
        parsed.targetRoot = takeValue(args, index, arg);
        index++;
      } else if (arg === '--source-root') {
        parsed.sourceRoot = takeValue(args, index, arg);
        index++;
      } else if (arg === '--version') {
        parsed.runtimeVersion = takeValue(args, index, arg);
        index++;
      } else if (arg === '--dry-run') {
        parsed.dryRun = true;
      } else if (arg === '--with-shims') {
        parsed.withShims = true;
      } else if (arg === '--with-profiles') {
        parsed.withProfiles = true;
      } else if (arg === '--with-path') {
        parsed.withPath = true;
      } else if (arg === '--without-path') {
        parsed.withoutPath = true;
      } else if (arg === '--keep-runtime') {
        parsed.keepRuntime = true;
      } else if (arg === '--json') {
        parsed.json = true;
      } else {
        throw new Error(`Opcion no reconocida: ${arg}\n${usage()}`);
      }
    }
    return parsed;
  }

  if (args[0] === 'init' || args[0] === 'migrate' || args[0] === 'uninit') {
    /* [108A-1 Fase 4] Bootstrap reproducible: init genera el contrato mínimo
     * (sentinel.config.json v2 + lock + init-manifest); migrate SOLO descubre
     * legacy; uninit retira solo lo administrado. Todos respetan --dry-run. */
    for (let index = 1; index < args.length; index++) {
      const arg = args[index];
      if (arg === '--preset') {
        parsed.initPreset = takeValue(args, index, arg);
        index++;
      } else if (arg === '--project-root' || arg === '--workspace') {
        parsed.workspacePath = takeValue(args, index, arg);
        index++;
      } else if (arg === '--primary-branch') {
        parsed.initPrimaryBranch = takeValue(args, index, arg);
        index++;
      } else if (arg === '--with-alias') {
        parsed.initAlias = takeValue(args, index, arg);
        index++;
      } else if (arg === '--analyzer-version') {
        parsed.initAnalyzerVersion = takeValue(args, index, arg);
        index++;
      } else if (arg === '--dry-run') {
        parsed.dryRun = true;
      } else if (arg === '--force') {
        parsed.force = true;
      } else if (arg === '--json') {
        parsed.json = true;
      } else {
        throw new Error(`Opcion no reconocida: ${arg}\n${usage()}`);
      }
    }
    return parsed;
  }

  let positionalIndex = -1;
  if (args[0] === 'check' && args.length > 1 && !args[1].startsWith('--')) {
    parsed.taskId = args[1];
    positionalIndex = 1;
  }

  for (let index = 1; index < args.length; index++) {
    if (index === positionalIndex) continue;
    const arg = args[index];

    switch (arg) {
      case '--workspace':
        parsed.workspacePath = takeValue(args, index, arg);
        index++;
        break;
      case '--file':
        parsed.filePath = takeValue(args, index, arg);
        index++;
        break;
      case '--files-from':
        parsed.filesFromPath = takeValue(args, index, arg);
        index++;
        break;
      case '--format': {
        const value = takeValue(args, index, arg);
        if (value !== 'markdown' && value !== 'json') {
          throw new Error('--format debe ser markdown o json');
        }
        parsed.format = value;
        index++;
        break;
      }
      case '--output':
        parsed.outputPath = takeValue(args, index, arg);
        index++;
        break;
      case '--config':
        parsed.configPath = takeValue(args, index, arg);
        index++;
        break;
      case '--task-id':
        parsed.taskId = takeValue(args, index, arg);
        index++;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--full':
        parsed.full = true;
        break;
      case '--ci':
        parsed.ci = true;
        break;
      case '--profile':
        parsed.profile = takeValue(args, index, arg);
        index++;
        break;
      case '--allow-heavy':
        /* [028A-6] El scheduler del core decide el full diferido: sin este
         * flag, un full en cooldown queda como local-light en el alcance. */
        parsed.allowHeavy = true;
        break;
      case '--stages':
        parsed.stagesPath = takeValue(args, index, arg);
        index++;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--shims':
        parsed.doctorShims = true;
        break;
      case '--max-file-bytes':
        parsed.maxFileBytes = parseLimite(takeValue(args, index, arg), arg);
        index++;
        break;
      case '--deadline-ms':
        parsed.deadlineMs = parseLimite(takeValue(args, index, arg), arg);
        index++;
        break;
      case '--max-findings':
        parsed.maxFindings = parseLimite(takeValue(args, index, arg), arg);
        index++;
        break;
      default:
        throw new Error(`Opcion no reconocida: ${arg}\n${usage()}`);
    }
  }

  if (parsed.filePath && (parsed.workspacePath || parsed.filesFromPath)) {
    throw new Error('Usa --file o --files-from/--workspace, no ambos');
  }
  /* [por que] Los límites solo tienen sentido en analyze; en otro comando se rechazan en vez de ignorarse. */
  const soloAnalyze = parsed.maxFileBytes !== undefined || parsed.deadlineMs !== undefined || parsed.maxFindings !== undefined;
  if (soloAnalyze && parsed.command !== 'analyze') {
    throw new Error('--max-file-bytes, --deadline-ms y --max-findings solo aplican a analyze');
  }

  parsed.workspacePath ??= process.cwd();
  return parsed;
}
