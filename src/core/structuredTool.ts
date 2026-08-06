/* [028A-6 Fase 1] Contrato estructurado de herramientas del gate agnóstico.
 * Port de scripts/quality/adapters/structured-tool.mjs + common.mjs: ejecuta
 * una herramienta declarada (executable/args/schema/timeout), valida su
 * reporte JSON (schemaVersion, entries, findings con ruleId/message/severidad
 * allowlisted) y produce un resultado de etapa con estados distinguibles
 * tool-error/timeout/cancelled/invalid-output. */
import path from 'node:path';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { physicallyContained, ensureContainedDirectory } from './pathContainment';
import { redact, truncate } from './redaction';
import { runProcess, ProcessResult } from './toolRunner';
import { GateFinding } from './gateReport';

const SEVERITIES = new Set(['information', 'hint', 'info', 'critical', 'error', 'warning']);
const MAX_LOG_BYTES = 200_000;

export function normalizeSeverity(value: unknown): 'error' | 'warning' | 'info' {
  if (value === 'information' || value === 'hint' || value === 'info') return 'info';
  if (value === 'critical' || value === 'error') return 'error';
  return 'warning';
}

export interface StructuredToolDefinition {
  name: string;
  executable: string;
  args: string[];
  reportPath?: string;
  expectedSchemaVersion?: string | number;
  timeoutMs?: number;
  cwd?: string;
}

export interface StructuredToolOptions {
  projectRoot: string;
  reportRoot: string;
  logsRoot: string;
  isCancelled?: () => boolean;
}

export interface ToolReportFinding {
  ruleId?: unknown;
  severity?: unknown;
  message?: unknown;
  file?: unknown;
  line?: unknown;
  range?: { start?: { line?: unknown } };
  suggestion?: unknown;
  remediation?: unknown;
  confidence?: unknown;
}

export interface ToolReportEntry {
  ruta?: unknown;
  file?: unknown;
  findings?: ToolReportFinding[];
}

export interface ToolReport {
  schemaVersion?: unknown;
  entries?: ToolReportEntry[];
  [key: string]: unknown;
}

export function normalizeEntries(entries: ToolReportEntry[] = []): GateFinding[] {
  return entries.flatMap(entry => (entry.findings ?? []).map(finding => {
    /* [028A-6 Fase 3] La línea llega en dos formatos según el emisor: el
     * adapter del orquestador publica `range.start.line` (0-based) y el
     * wrapper stage-process.mjs normaliza a `line` directo (1-based). */
    const rangeLine = finding.range?.start?.line;
    const directLine = finding.line;
    const line = Number.isInteger(directLine)
      ? Number(directLine)
      : Number.isInteger(rangeLine) ? Number(rangeLine) + 1 : undefined;
    return {
      ruleId: String(finding.ruleId ?? 'unknown'),
      severity: normalizeSeverity(finding.severity),
      file: (entry.ruta ?? entry.file ?? finding.file)
        ? String(entry.ruta ?? entry.file ?? finding.file).replace(/\\/g, '/')
        : undefined,
      line,
      message: redact(String(finding.message ?? 'Hallazgo sin mensaje')),
    };
  }));
}

export async function readToolReport(reportPath: string): Promise<ToolReport> {
  let report: unknown;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    throw new Error(`JSON inválido en ${reportPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('el reporte debe ser un objeto');
  }
  const typed = report as ToolReport;
  if (!Array.isArray(typed.entries)) {
    throw new Error('el reporte debe contener entries como lista');
  }
  for (const entry of typed.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Array.isArray(entry.findings)) {
      throw new Error('cada entrada del reporte debe contener findings como lista');
    }
    for (const finding of entry.findings) {
      if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
        throw new Error('cada finding debe ser un objeto');
      }
      if (typeof finding.ruleId !== 'string' || finding.ruleId.length === 0 || typeof finding.message !== 'string') {
        throw new Error('cada finding debe contener ruleId y message');
      }
      if (!SEVERITIES.has(String(finding.severity))) {
        throw new Error('severity de finding desconocida');
      }
    }
  }
  return typed;
}

export async function writeStageLog(logsRoot: string, stage: string, content: string): Promise<string> {
  const target = path.join(logsRoot, `${stage}.log`);
  const temporary = `${target}.tmp`;
  await mkdir(logsRoot, { recursive: true });
  await writeFile(temporary, truncate(content, MAX_LOG_BYTES), 'utf8');
  await rename(temporary, target);
  return target;
}

export interface ToolOutcome {
  stage: string;
  status: 'pass' | 'fail' | 'error';
  state: string;
  cached: boolean;
  durationMs: number;
  findings: GateFinding[];
  summary: string;
  logPath?: string;
}

export function toolFailure(stage: string, execution: ProcessResult, state: 'timeout' | 'cancelled' | 'tool-error' | 'invalid-output', logPath?: string): ToolOutcome {
  const timedOut = state === 'timeout';
  const cancelled = state === 'cancelled';
  const invalidOutput = state === 'invalid-output';
  return {
    stage,
    status: 'error',
    state,
    cached: false,
    durationMs: execution.durationMs,
    findings: [{
      ruleId: timedOut ? 'quality-timeout' : cancelled ? 'quality-cancelled' : invalidOutput ? 'quality-invalid-output' : 'quality-tool-error',
      severity: 'error',
      message: timedOut ? `${stage} excedió el timeout` : cancelled ? `${stage} fue cancelado` : invalidOutput ? `${stage} produjo una salida estructuralmente inválida` : `${stage} terminó con código ${execution.code}`,
    }],
    summary: timedOut ? 'timeout' : cancelled ? 'cancelled' : invalidOutput ? 'invalid-output' : `error ${execution.code}`,
    logPath,
  };
}

export function resultFromFindings(stage: string, findings: GateFinding[], durationMs: number, logPath?: string): ToolOutcome {
  const errors = findings.filter(item => item.severity === 'error').length;
  const warnings = findings.filter(item => item.severity === 'warning').length;
  const infos = findings.filter(item => item.severity === 'info').length;
  return {
    stage,
    status: errors > 0 ? 'fail' : 'pass',
    state: errors > 0 || findings.length > 0 ? 'findings' : 'pass',
    cached: false,
    durationMs,
    findings,
    summary: `${errors} errores, ${warnings} warnings, ${infos} info`,
    logPath,
  };
}

export async function runStructuredTool(definition: StructuredToolDefinition, options: StructuredToolOptions): Promise<ToolOutcome> {
  const reportPath = definition.reportPath ?? path.join(options.reportRoot, `${definition.name}.json`);
  await ensureContainedDirectory(options.reportRoot, path.dirname(reportPath), 'reportPath');
  await physicallyContained(options.reportRoot, reportPath, 'reportPath');
  const execution = await runProcess(definition.executable, definition.args, {
    cwd: definition.cwd ?? options.projectRoot,
    timeoutMs: definition.timeoutMs,
    isCancelled: options.isCancelled,
  });
  const logPath = await writeStageLog(options.logsRoot, definition.name, `${execution.stdout}\n${execution.stderr}`);
  if (execution.timedOut) return toolFailure(definition.name, execution, 'timeout', logPath);
  if (execution.cancelled) return toolFailure(definition.name, execution, 'cancelled', logPath);
  if (execution.code !== 0) return toolFailure(definition.name, execution, 'tool-error', logPath);
  try {
    await physicallyContained(options.reportRoot, reportPath, 'reportPath');
    const reportStat = await lstat(reportPath);
    if (reportStat.isSymbolicLink() || !reportStat.isFile()) throw new Error('reportPath debe ser un archivo regular no simbólico');
    const report = await readToolReport(reportPath);
    if (String(report.schemaVersion) !== String(definition.expectedSchemaVersion ?? '1')) {
      throw new Error(`schema ${String(report.schemaVersion)} incompatible (esperado ${String(definition.expectedSchemaVersion ?? '1')})`);
    }
    return resultFromFindings(definition.name, normalizeEntries(report.entries), execution.durationMs, logPath);
  } catch (error) {
    return toolFailure(definition.name, { ...execution, code: 2, stderr: error instanceof Error ? error.message : String(error) }, 'invalid-output', logPath);
  }
}
