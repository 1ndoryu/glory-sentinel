/* [108A-1 Fase 2] Capa de parsing del CLI único de Sentinel: argumentos,
 * usage y despacho por comandos separado de la ejecución (./commands). El
 * contrato público del módulo '../../cli' no cambia (index.ts re-exporta). */
import type { SentinelConfigFile } from '../core/config';
import type { CoreReportEntry } from '../core/report';

export type TaskAction = 'claim' | 'start' | 'heartbeat' | 'status' | 'gate' | 'integrate' | 'cleanup' | 'release' | 'recover';

export interface TaskCliArgs {
  command: 'task';
  taskAction: TaskAction;
  taskId?: string;
  workspacePath?: string;
  agent?: string;
  base?: string;
  target?: string;
  primaryBranch?: string;
  worktreePath?: string;
  force?: boolean;
  dryRun?: boolean;
  full?: boolean;
  ci?: boolean;
  allowHeavy?: boolean;
  stagesPath?: string;
  json?: boolean;
  outputPath?: string;
}

export type TaskCliResult = Record<string, unknown>;

export function formatTaskResult(result: TaskCliResult, json = false): string {
  if (json) return `${JSON.stringify(result, null, 2)}\n`;
  const lines = Object.entries(result).map(([key, value]) => `  ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return `${lines.join('\n')}\n`;
}

export function taskUsage(): string {
  return [
    'Uso de tareas:',
    '  sentinel task claim <id> --project-root <dir> --agent <id> [--force] [--json]',
    '  sentinel task start <id> --project-root <dir> --agent <id> [--primary-branch <branch>] [--path <dir>]',
    '  sentinel task heartbeat <id> --project-root <dir> --agent <id>',
    '  sentinel task status --project-root <dir> [--json]',
    '  sentinel task gate <id> --project-root <worktree> --agent <id> [--full|--ci]',
    '  sentinel task integrate <id> --project-root <dir> --agent <id> [--target <primary-branch>]',
    '  sentinel task cleanup <id> --project-root <dir> --agent <id> [--force]',
    '  sentinel task release <id> --project-root <dir> --agent <id>',
    '  sentinel task recover <id> --project-root <dir> --agent <id> [--dry-run]',
  ].join('\\n');
}

export type CliFormat = 'markdown' | 'json';


export type SentinelCliConfigFile = SentinelConfigFile;


export interface ParsedCliArgs {
  command: 'analyze' | 'check' | 'guard' | 'doctor' | 'status' | 'install' | 'update' | 'rollback' | 'uninstall' | 'lease' | 'task' | 'init' | 'migrate' | 'uninit';
  taskAction?: TaskAction;
  agent?: string;
  base?: string;
  worktreePath?: string;
  force?: boolean;
  leaseAction?: 'issue' | 'list' | 'revoke' | 'verify';
  leasePath?: string;
  leaseCommand?: string;
  leasePid?: number;
  leaseTtlMs?: number;
  workspacePath?: string;
  /* [108A-1 F6] `doctor --shims`: lista qué ejecutable gana realmente en PATH. */
  doctorShims?: boolean;
  filePath?: string;
  filesFromPath?: string;
  format: CliFormat;
  outputPath?: string;
  configPath?: string;
  taskId?: string;
  dryRun?: boolean;
  full?: boolean;
  ci?: boolean;
  profile?: string;
  allowHeavy?: boolean;
  json?: boolean;
  stagesPath?: string;
  guardExecutable?: string;
  guardProjectRoot?: string;
  guardArgs?: string[];
  targetRoot?: string;
  sourceRoot?: string;
  runtimeVersion?: string;
  withShims?: boolean;
  withProfiles?: boolean;
  withPath?: boolean;
  withoutPath?: boolean;
  keepRuntime?: boolean;
  /* [108A-1 Fase 4] Opciones de init/migrate/uninit. */
  initPreset?: string;
  initPrimaryBranch?: string;
  initAlias?: string;
  initAnalyzerVersion?: string;
}

export interface CliAnalysisResult {
  entries: CoreReportEntry[];
  totalArchivos: number;
  hasErrors: boolean;
  durationMs: number;
}

export const SENTINEL_JSON_SCHEMA_VERSION = '1';

export function usage(): string {
  return [
    'Uso:',
    '  sentinel analyze --workspace . --format markdown --output .sentinel-report.md',
    '  sentinel analyze --file src/app.ts --format json',
    '  sentinel analyze --workspace . --files-from .changed-files --format json',
    '  sentinel check <task-id> --dry-run [--workspace .] [--full|--ci] [--profile rust,...]',
    '  sentinel check <task-id> --stages <json> [--full|--ci] [--workspace .]',
    '  sentinel guard --executable <exe> [--project-root <dir>] [--json] -- <args...>',
    '  sentinel doctor [--json] [--workspace .] [--shims]',
    '  sentinel status [--json] [--workspace .]',
    '  sentinel install [--target-root <dir>] [--source-root <dir>] [--version <v>] [--dry-run] [--with-shims] [--with-profiles] [--with-path] [--without-path] [--json]',
    '  sentinel update [--target-root <dir>] [--source-root <dir>] [--version <v>] [--dry-run] [--with-shims] [--with-profiles] [--with-path] [--without-path] [--json]',
    '  sentinel rollback [--target-root <dir>] [--version <v>] [--dry-run] [--json]',
    '  sentinel uninstall [--target-root <dir>] [--dry-run] [--keep-runtime] [--json]',
    '  sentinel lease issue --project-root <dir> [--task-id <id>] [--command <cmd>] [--ttl-ms <ms>] [--json]',
    '  sentinel lease list [--json]',
    '  sentinel lease revoke --lease <path> [--json]',
    '  sentinel lease verify --lease <path> [--project-root <dir>] [--pid <n>] [--json]',
    '  sentinel task claim|start|heartbeat|status|gate|integrate|cleanup|release|recover <id> [opciones]',
    '  sentinel init --preset <node|rust|python|mixed> [--project-root <dir>] [--primary-branch <rama>] [--dry-run] [--force] [--with-alias <nombre>] [--json]',
    '  sentinel migrate --project-root <dir> [--json]',
    '  sentinel uninit --project-root <dir> [--dry-run] [--json]',
    '  sentinel --version',
    '',
    'Opciones:',
    '  --workspace <path>  Analiza un workspace. Por defecto: cwd',
    '  --file <path>       Analiza un archivo puntual',
    '  --files-from <path> Lee archivos relativos al workspace, uno por linea',
    '  --format <type>     markdown | json. Por defecto: markdown',
    '  --output <path>     Escribe salida en archivo; si falta, imprime en stdout',
    '  --config <path>     Carga sentinel.config.json',
    '  --task-id <id>      Tarea a comprobar (check)',
    '  --dry-run           Calcula el alcance sin ejecutar el gate (check)',
    '  --full / --ci       Fuerza alcance full (check)',
    '  --profile <csv>     Perfiles ejecutables explicitos (check)',
    '  --allow-heavy       Tolera full aunque el guard este en cooldown (check)',
    '  --stages <path>     Ejecuta las etapas declarativas JSON (check sin --dry-run)',
    '  --target-root <dir> Directorio del runtime global (install/update/rollback)',
    '  --source-root <dir> Origen del artefacto a instalar (install/update)',
    '  --version <v>       Version a instalar o restaurar (install/update/rollback)',
    '  --dry-run           Simula sin escribir nada (install/update/rollback)',
    '  --with-shims        Genera los shims interceptores en <target>/shims (install/update)',
    '  --with-profiles     Dot-sourcea el guard en los perfiles con backup previo (install/update)',
    '  --with-path         Añade <target>/shims al PATH de usuario (install/update; implica --with-shims)',
    '  --without-path      Retira <target>/shims del PATH de usuario (install)',
    '  --keep-runtime      Conserva versions/current/bin al desinstalar (uninstall)',
    '  --lease <path>      Ruta del lease (revoke/verify)',
    '  --pid <n>           PID a verificar como descendiente del emisor (verify)',
    '  --command <cmd>     Comando/propósito del lease (issue/verify)',
    '  --ttl-ms <ms>       TTL del lease en ms (issue)',
    '  --json              Salida JSON (guard/doctor/status/install/update/rollback/lease)',
    '  --help              Muestra esta ayuda',
    '  --version           Muestra la version instalada',
  ].join('\n');
}

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Falta valor para ${option}`);
  }
  return value;
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

export function parseCliArgs(args: string[]): ParsedCliArgs {
  if (args[0] === 'task') return parseTaskCliArgs(args) as unknown as ParsedCliArgs;
  if (!['analyze', 'check', 'guard', 'doctor', 'status', 'install', 'update', 'rollback', 'uninstall', 'lease', 'init', 'migrate', 'uninit'].includes(args[0] ?? '')) {
    throw new Error(usage());
  }

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
      } else if (arg === '--help' || arg === '-h') {
        throw new Error(usage());
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
      } else if (arg === '--help' || arg === '-h') {
        throw new Error(usage());
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
      } else if (arg === '--help' || arg === '-h') {
        throw new Error(usage());
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
      } else if (arg === '--help' || arg === '-h') {
        throw new Error(usage());
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
      case '--help':
      case '-h':
        throw new Error(usage());
      default:
        throw new Error(`Opcion no reconocida: ${arg}\n${usage()}`);
    }
  }

  if (parsed.filePath && (parsed.workspacePath || parsed.filesFromPath)) {
    throw new Error('Usa --file o --files-from/--workspace, no ambos');
  }

  parsed.workspacePath ??= process.cwd();
  return parsed;
}
