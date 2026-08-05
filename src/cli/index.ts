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
import { detectScope, ScopeQualityConfig } from '../core/scope';
import { inspectHeavyRun } from '../core/scheduler';
import { inicializarGloryAnalyzer } from '../analyzers/gloryAnalyzer';

export type CliFormat = 'markdown' | 'json';

export { languageIdForFile };

export type SentinelCliConfigFile = SentinelConfigFile;


export interface ParsedCliArgs {
  command: 'analyze' | 'check';
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

export function parseCliArgs(args: string[]): ParsedCliArgs {
  if (args[0] !== 'analyze' && args[0] !== 'check') {
    throw new Error(usage());
  }

  const parsed: ParsedCliArgs = {
    command: args[0],
    format: 'markdown',
  };

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

async function loadScopeQualityConfig(workspace: string): Promise<ScopeQualityConfig> {
  /* [028A-6] Fuente de transición: quality.config.json aporta fullPatterns y
   * perfiles como datos. La fuente canónica del core será la política v2
   * (sentinel.config.json) cuando la Fase 1 del plan 028A-6 la consuma. */
  try {
    const raw = JSON.parse(await fs.readFile(path.join(workspace, 'quality.config.json'), 'utf8')) as Partial<ScopeQualityConfig>;
    return {
      fullPatterns: Array.isArray(raw.fullPatterns) ? raw.fullPatterns : [],
      profiles: raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {},
    };
  } catch {
    return { fullPatterns: [], profiles: {} };
  }
}

export async function checkCliTarget(args: ParsedCliArgs): Promise<string> {
  if (!args.dryRun) {
    throw new Error('check requiere --dry-run: el orquestador completo se está migrando (028A-6 Fase 1)');
  }
  const workspace = path.resolve(args.workspacePath ?? process.cwd());
  const reportRoot = path.join(workspace, '.quality-reports', 'check-dry-run');
  await fs.mkdir(reportRoot, { recursive: true });
  const requestedFull = args.full ?? false;
  const requestedCi = args.ci ?? false;
  /* [028A-6] El scheduler decide el full diferido: si el guard está en
   * cooldown (y no hay override), el alcance efectivo es local-light y el
   * motivo llega al manifest como heavy-deferred, igual que el orquestador. */
  const guardDecision = requestedFull || requestedCi
    ? await inspectHeavyRun({
        projectRoot: workspace,
        mode: requestedCi ? 'ci' : 'full',
        allowHeavy: args.allowHeavy ?? false,
      })
    : null;
  const heavyGuard = guardDecision && !guardDecision.allowed
    ? { reason: guardDecision.reason ?? 'guard', nextAllowedAt: guardDecision.nextAllowedAt ?? null }
    : null;
  const scope = await detectScope(
    {
      projectRoot: workspace,
      reportRoot,
      qualityConfig: await loadScopeQualityConfig(workspace),
    },
    {
      full: requestedFull,
      ci: requestedCi,
      heavyDeferred: heavyGuard,
      profiles: args.profile ? args.profile.split(',').map(item => item.trim()).filter(Boolean) : [],
    },
  );
  return `${JSON.stringify({
    ...scope,
    profiles: [...scope.profiles],
    taskId: args.taskId ?? null,
    heavyGuard,
  }, null, 2)}\n`;
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
  if (args.command === 'check') {
    const output = await checkCliTarget(args);
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
