#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { analyzeDocument } from '../core/analyzeDocument';
import {
  buildCoreConfig,
  SentinelConfigFile,
  validateSentinelConfig,
} from '../core/config';
import { generarReporteMarkdown, CoreReportEntry } from '../core/report';
import { CoreAnalysisConfig, createCoreDocument } from '../core/types';
import { languageIdForFile } from '../core/language';
import {
  formatBlockMessage,
  inspectDirectCommand,
  QUALITY_GUARD_EXIT_CODE,
} from '../core/guardCommand';
import { diagnoseWorkspace, formatDiagnose, formatStatus } from '../core/diagnose';
import { runCheck, CheckRunResult } from '../core/gateRun';
import { cancelAll } from '../core/toolRunner';
import { resolveGuardRoot, resolveTargetBase } from '../core/scheduler';
import {
  formatLeaseList,
  issueLease,
  listLeases,
  revokeLease,
  verifyLease,
} from '../core/lease';
import {
  installRuntime,
  rollbackRuntime,
  uninstallRuntime,
  formatRuntimeResult,
  RuntimeInstallResult,
  RuntimeRollbackResult,
  RuntimeUninstallResult,
} from '../core/runtimeInstall';
import {
  defaultProfilePaths,
  formatPathEntryResult,
  formatProfilesResult,
  installPathEntry,
  installProfiles,
  uninstallPathEntry,
  writeInterceptorShims,
} from '../core/interceptorShims';
import { inicializarGloryAnalyzer } from '../analyzers/gloryAnalyzer';
import {
  claimTask,
  cleanupTask,
  heartbeatTask,
  integrateTask,
  releaseTask,
  startTask,
  taskStatus,
  recordTaskGateRun,
  verifyTaskWorktree,
} from '../core/taskCoordinator';

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
  worktreesRoot?: string;
  envManifestPath?: string;
  force?: boolean;
  dryRun?: boolean;
  full?: boolean;
  ci?: boolean;
  allowHeavy?: boolean;
  stagesPath?: string;
  json?: boolean;
  outputPath?: string;
  all?: boolean;
  summary?: string;
  planReference?: string;
  relatedTaskIds?: string[];
}

export type TaskCliResult = Record<string, unknown>;

export function formatTaskResult(result: TaskCliResult, json = false): string {
  if (json) return `${JSON.stringify(result, null, 2)}\n`;
  const lines = Object.entries(result).map(([key, value]) => `  ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return `${lines.join('\n')}\n`;
}

function taskUsage(): string {
  return [
    'Uso de tareas:',
    '  sentinel task claim <id> --project-root <dir> --agent <id> [--force] [--json]',
    '  sentinel task start <id> --project-root <dir> --agent <id> [--primary-branch <branch>] [--path <dir>] [--worktrees-root <dir>] [--env-manifest <path>]',
    '  sentinel task heartbeat <id> --project-root <dir> --agent <id>',
    '  sentinel task status --project-root <dir> [--all] [--json]',
    '  sentinel task gate <id> --project-root <worktree> --agent <id> [--full|--ci]',
    '  sentinel task integrate <id> --project-root <dir> --agent <id> [--target <primary-branch>]',
    '  sentinel task cleanup <id> --project-root <dir> --agent <id> [--force]',
    '  sentinel task release <id> --project-root <dir> --agent <id>',
    '  sentinel task recover <id> --project-root <dir> --agent <id> [--dry-run]',
  ].join('\\n');
}

export type CliFormat = 'markdown' | 'json';

export { languageIdForFile };

export type SentinelCliConfigFile = SentinelConfigFile;


export interface ParsedCliArgs {
  command: 'analyze' | 'check' | 'guard' | 'doctor' | 'status' | 'install' | 'update' | 'rollback' | 'uninstall' | 'lease' | 'task';
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
}

export interface CliAnalysisResult {
  entries: CoreReportEntry[];
  totalArchivos: number;
  hasErrors: boolean;
  durationMs: number;
}

export const SENTINEL_JSON_SCHEMA_VERSION = '1';

function usage(): string {
  return [
    'Uso:',
    '  sentinel analyze --workspace . --format markdown --output .sentinel-report.md',
    '  sentinel analyze --file src/app.ts --format json',
    '  sentinel analyze --workspace . --files-from .changed-files --format json',
    '  sentinel check <task-id> --dry-run [--workspace .] [--full|--ci] [--profile rust,...]',
    '  sentinel check <task-id> --stages <json> [--full|--ci] [--workspace .]',
    '  sentinel guard --executable <exe> [--project-root <dir>] [--json] -- <args...>',
    '  sentinel doctor [--json] [--workspace .]',
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

export function parseCliArgs(args: string[]): ParsedCliArgs {
  if (args[0] === 'task') return parseTaskCliArgs(args) as unknown as ParsedCliArgs;
  if (!['analyze', 'check', 'guard', 'doctor', 'status', 'install', 'update', 'rollback', 'uninstall', 'lease'].includes(args[0] ?? '')) {
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readConfig(configPath?: string, workspacePath?: string): Promise<SentinelCliConfigFile> {
  const candidate = configPath
    ? path.resolve(configPath)
    : path.resolve(workspacePath ?? process.cwd(), 'sentinel.config.json');

  if (!await fileExists(candidate)) {
    return {};
  }

  const raw = await fs.readFile(candidate, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  validateSentinelConfig(parsed);
  return parsed;
}

function normalizarRuta(ruta: string): string {
  return ruta.replace(/\\/g, '/');
}

function matchesAny(relativePath: string, patterns: string[]): boolean {
  const normalized = normalizarRuta(relativePath);
  return patterns.some(pattern =>
    minimatch(normalized, pattern, { dot: true }) ||
    minimatch(`${normalized}/`, pattern, { dot: true })
  );
}

async function collectFiles(rootPath: string, config: CoreAnalysisConfig): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = normalizarRuta(path.relative(rootPath, absolutePath));

      if (matchesAny(relativePath, config.excludePatterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile() && matchesAny(relativePath, config.includePatterns)) {
        files.push(absolutePath);
      }
    }
  }

  await walk(rootPath);
  return files;
}

async function analyzeFile(filePath: string, rootPath: string, config: CoreAnalysisConfig): Promise<CoreReportEntry> {
  const content = await fs.readFile(filePath, 'utf8');
  const document = createCoreDocument({
    uri: `file://${normalizarRuta(filePath)}`,
    fileName: filePath,
    languageId: languageIdForFile(filePath),
    content,
  });

  return {
    ruta: filePath,
    findings: analyzeDocument(document, config, {
      rootPath,
      config,
    }),
  };
}

async function collectFilesFromList(
  listPath: string,
  workspacePath: string,
  config: CoreAnalysisConfig,
): Promise<string[]> {
  const raw = await fs.readFile(path.resolve(listPath), 'utf8');
  const files = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate || candidate.startsWith('#')) {
      continue;
    }
    const absolutePath = path.resolve(workspacePath, candidate);
    const relativePath = normalizarRuta(path.relative(workspacePath, absolutePath));
    if (relativePath === '..' || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
      throw new Error(`--files-from contiene una ruta fuera del workspace: ${candidate}`);
    }
    if (!matchesAny(relativePath, config.includePatterns) || matchesAny(relativePath, config.excludePatterns)) {
      continue;
    }
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`--files-from no apunta a un archivo: ${candidate}`);
    }
    files.add(absolutePath);
  }

  return [...files].sort();
}

export async function analyzeCliTarget(args: ParsedCliArgs): Promise<CliAnalysisResult> {
  const startedAt = Date.now();
  const workspacePath = path.resolve(args.workspacePath ?? process.cwd());
  const configFile = await readConfig(args.configPath, workspacePath);
  const config = buildCoreConfig(configFile);
  inicializarGloryAnalyzer([workspacePath]);

  const files = args.filePath
    ? [path.resolve(args.filePath)]
    : args.filesFromPath
      ? await collectFilesFromList(args.filesFromPath, workspacePath, config)
      : await collectFiles(workspacePath, config);

  const entries: CoreReportEntry[] = [];
  for (const filePath of files) {
    const entry = await analyzeFile(filePath, workspacePath, config);
    if (entry.findings.length > 0) {
      entries.push(entry);
    }
  }

  return {
    entries,
    totalArchivos: files.length,
    hasErrors: entries.some(entry => entry.findings.some(finding => finding.severity === 'error')),
    durationMs: Date.now() - startedAt,
  };
}

function severityCounts(result: CliAnalysisResult): Record<string, number> {
  const counts: Record<string, number> = { error: 0, warning: 0, information: 0, hint: 0 };
  for (const finding of result.entries.flatMap(entry => entry.findings)) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  return counts;
}

function renderOutput(result: CliAnalysisResult, args: ParsedCliArgs, toolVersion: string): string {
  if (args.format === 'json') {
    return `${JSON.stringify({
      schemaVersion: SENTINEL_JSON_SCHEMA_VERSION,
      tool: { name: 'glory-sentinel', version: toolVersion },
      scope: args.filePath ? 'file' : args.filesFromPath ? 'files' : 'workspace',
      durationMs: result.durationMs,
      severityCounts: severityCounts(result),
      totalArchivos: result.totalArchivos,
      totalArchivosConViolaciones: result.entries.length,
      entries: result.entries,
    }, null, 2)}\n`;
  }

  return `${generarReporteMarkdown({
    entries: result.entries,
    totalArchivos: result.totalArchivos,
    rutaBase: path.resolve(args.workspacePath ?? process.cwd()),
  })}\n`;
}

async function readPackageVersion(): Promise<string> {
  /* [SNT-16g] Un CLI instalado se ejecuta bajo
   * <runtime>/versions/<version>/out/cli. Si existe current.json en sus
   * ancestros, esa es la identidad activa y tiene prioridad sobre un
   * package.json antiguo que pueda quedar detrás de un shim obsoleto. En un
   * checkout de desarrollo no hay current.json y se conserva el package.json. */
  let directory = path.resolve(__dirname);
  while (true) {
    try {
      const current = JSON.parse(await fs.readFile(path.join(directory, 'current.json'), 'utf8')) as { version?: unknown };
      if (typeof current.version === 'string' && current.version.length > 0) {
        const activeCli = path.join(directory, 'versions', current.version, 'out', 'cli', 'index.js');
        await fs.access(activeCli);
        return current.version;
      }
    } catch {
      /* El directorio actual no es la raíz de un runtime instalado. */
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const packagePath = path.resolve(__dirname, '../../package.json');
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8')) as { version?: unknown };
  if (typeof packageJson.version !== 'string') {
    throw new Error('package.json no contiene una version valida');
  }
  return packageJson.version;
}

async function writeOrPrint(output: string, outputPath?: string): Promise<void> {
  if (!outputPath) {
    process.stdout.write(output);
    return;
  }

  const resolved = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, output, 'utf8');
}

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

export async function guardCliTarget(args: ParsedCliArgs): Promise<number> {
  const decision = await inspectDirectCommand({
    executable: args.guardExecutable ?? '',
    args: args.guardArgs ?? [],
    cwd: args.workspacePath ?? process.cwd(),
    projectRoot: args.guardProjectRoot,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  } else if (decision.blocked) {
    process.stderr.write(`${formatBlockMessage(decision)}\n`);
  }
  return decision.blocked ? (decision.exitCode ?? QUALITY_GUARD_EXIT_CODE) : 0;
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

export async function leaseCliTarget(args: ParsedCliArgs): Promise<string> {
  const guardRoot = resolveGuardRoot(resolveTargetBase());
  switch (args.leaseAction) {
    case 'issue': {
      const projectRoot = path.resolve(args.workspacePath ?? process.cwd());
      const issued = await issueLease({
        projectRoot,
        taskId: args.taskId ?? null,
        command: args.leaseCommand ?? 'gate',
        ttlMs: args.leaseTtlMs,
      });
      return args.json
        ? `${JSON.stringify({ path: issued.path, envVar: issued.envVar, lease: issued.lease }, null, 2)}\n`
        : `Lease emitido:\n  ${issued.envVar}=${issued.path}\n`;
    }
    case 'list': {
      const leases = await listLeases(guardRoot);
      return args.json ? `${JSON.stringify(leases, null, 2)}\n` : formatLeaseList(leases);
    }
    case 'revoke': {
      if (!args.leasePath) throw new Error('lease revoke requiere --lease <path>');
      const result = await revokeLease({ leasePath: args.leasePath, reason: 'revocación manual' });
      return args.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Lease ${result.revoked ? 'revocado' : 'ya ausente'}: ${args.leasePath}\n`;
    }
    case 'verify': {
      if (!args.leasePath) throw new Error('lease verify requiere --lease <path>');
      const projectRoot = path.resolve(args.workspacePath ?? process.cwd());
      const verification = await verifyLease({
        leasePath: args.leasePath,
        projectRoot,
        pid: args.leasePid ?? process.pid,
        command: args.leaseCommand ?? '',
      });
      return args.json
        ? `${JSON.stringify(verification, null, 2)}\n`
        : `Lease ${verification.valid ? 'válido' : `inválido (${verification.reason ?? 'desconocido'})`}\n`;
    }
    default:
      throw new Error(usage());
  }
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
      const mode = args.ci ? 'ci' : args.full ? 'full' : 'local';
      try {
        const check = await checkCliTarget({
          command: 'check', format: 'markdown', workspacePath: workspace, taskId,
          full: args.full, ci: args.ci, allowHeavy: args.allowHeavy, stagesPath: args.stagesPath,
        });
        await recordTaskGateRun({ projectRoot: workspace, taskId, agent, primaryBranch, mode, status: check.exitCode === 0 ? 'PASS' : 'FAIL', exitCode: check.exitCode, reportPath: path.relative(workspace, path.join(workspace, '.quality-reports', 'check', taskId)).replace(/\\/gu, '/') });
        result = { taskId, gateExitCode: check.exitCode, output: check.output };
      } catch (error) {
        await recordTaskGateRun({ projectRoot: workspace, taskId, agent, primaryBranch, mode, status: 'ERROR', exitCode: 1 });
        throw error;
      }
      break;
    }
    case 'integrate': result = { ...(await integrateTask({ projectRoot: workspace, taskId, agent, target: args.target, primaryBranch })) }; break;
    case 'cleanup': {
      const state = await cleanupTask({ projectRoot: workspace, taskId, agent, primaryBranch, force: args.force });
      result = { taskId, state: state ?? 'NOT_FOUND' };
      break;
    }
    case 'release': await releaseTask({ projectRoot: workspace, taskId, agent, primaryBranch }); result = { taskId, state: 'RELEASED' }; break;
    case 'recover': {
      if (!primaryBranch) throw new Error('task recover requiere project.primaryBranch en sentinel.config.json');
      const { recoverTask } = await import('../core/taskRecovery');
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

  const args = parseCliArgs(rawArgs);
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
      return 0;
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
    const output = args.json
      ? `${JSON.stringify(diagnosis, null, 2)}\n`
      : `${(args.command === 'doctor' ? formatDiagnose(diagnosis) : formatStatus(diagnosis))}\n`;
    await writeOrPrint(output, args.outputPath);
    /* Doctor es preflight fail-closed: una capacidad ausente, checkout dirty,
     * lock divergente o release no publicada debe producir exit != 0 antes de
     * que un gate/instalador intente ejecutar etapas. `status` sigue siendo
     * observabilidad read-only y conserva exit 0. */
    return args.command === 'doctor' && !diagnosis.ready ? 1 : 0;
  }
  if (args.command === 'lease') {
    const output = await leaseCliTarget(args);
    await writeOrPrint(output, args.outputPath);
    return 0;
  }
  const result = await analyzeCliTarget(args);
  await writeOrPrint(renderOutput(result, args, await readPackageVersion()), args.outputPath);
  return result.hasErrors ? 1 : 0;
}

if (require.main === module) {
  runCli(process.argv.slice(2))
    .then(code => { process.exitCode = code; })
    .catch(error => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    });
}
