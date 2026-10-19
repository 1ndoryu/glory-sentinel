/* [108A-1 Fase 2] Comando `analyze`: recorre el workspace (o una lista/archivo),
 * analiza cada documento y renderiza el reporte en markdown o JSON. */
import * as fs from 'fs/promises';
import * as path from 'path';
import { Minimatch } from 'minimatch';
import { analizarDocumento } from '../../analyzers/pipeline';
import { inicializarGloryAnalyzer } from '../../analyzers/gloryAnalyzer';
import { buildCoreConfig } from '../../core/runtime-proyecto/config';
import { generarReporteMarkdown, CoreReportEntry } from '../../core/diagnostico/report';
import { CoreAnalysisConfig, createCoreDocument } from '../../core/runtime-proyecto/types';
import { languageIdForFile } from '../../core/runtime-proyecto/language';
import { CliAnalysisResult, ParsedCliArgs, SENTINEL_JSON_SCHEMA_VERSION } from '../parseo/argsTypes';
import { readConfig } from './cliShared';

function normalizarRuta(ruta: string): string {
  return ruta.replace(/\\/g, '/');
}

/* minimatch(ruta, patron) re-parsea el patron en cada llamada; collectFiles evalua
 * cada entrada del arbol, asi que los patrones se compilan una vez por lista. */
function compilarPatrones(patterns: string[]): Minimatch[] {
  return patterns.map(pattern => new Minimatch(pattern, { dot: true }));
}

function matchesAny(relativePath: string, matchers: Minimatch[]): boolean {
  const normalized = normalizarRuta(relativePath);
  return matchers.some(matcher =>
    matcher.match(normalized) ||
    matcher.match(`${normalized}/`)
  );
}

async function collectFiles(rootPath: string, config: CoreAnalysisConfig): Promise<string[]> {
  const files: string[] = [];
  const excluir = compilarPatrones(config.excludePatterns);
  const incluir = compilarPatrones(config.includePatterns);

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = normalizarRuta(path.relative(rootPath, absolutePath));

      if (matchesAny(relativePath, excluir)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile() && matchesAny(relativePath, incluir)) {
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
    findings: analizarDocumento(document, config, {
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
  const excluir = compilarPatrones(config.excludePatterns);
  const incluir = compilarPatrones(config.includePatterns);

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
    if (!matchesAny(relativePath, incluir) || matchesAny(relativePath, excluir)) {
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

export function renderOutput(result: CliAnalysisResult, args: ParsedCliArgs, toolVersion: string): string {
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
