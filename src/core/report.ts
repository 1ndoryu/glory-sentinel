import { CoreFinding, CoreSeverity } from './types';

export interface CoreReportEntry {
  ruta: string;
  findings: CoreFinding[];
}

export interface CoreWorkspaceReportInput {
  entries: CoreReportEntry[];
  totalArchivos: number;
  rutaBase?: string;
  fecha?: Date;
}

export interface CoreReportSummary {
  totalErrores: number;
  totalWarnings: number;
  totalInfo: number;
  totalHints: number;
  totalViolaciones: number;
}

function normalizarRuta(ruta: string): string {
  return ruta.replace(/\\/g, '/');
}

export function severidadTextoCore(severity: CoreSeverity): string {
  switch (severity) {
    case 'error': return 'Error';
    case 'warning': return 'Warning';
    case 'information': return 'Info';
    case 'hint': return 'Hint';
  }
}

export function calcularResumenReporte(entries: CoreReportEntry[]): CoreReportSummary {
  const summary: CoreReportSummary = {
    totalErrores: 0,
    totalWarnings: 0,
    totalInfo: 0,
    totalHints: 0,
    totalViolaciones: 0,
  };

  for (const entrada of entries) {
    for (const finding of entrada.findings) {
      summary.totalViolaciones++;
      switch (finding.severity) {
        case 'error': summary.totalErrores++; break;
        case 'warning': summary.totalWarnings++; break;
        case 'information': summary.totalInfo++; break;
        case 'hint': summary.totalHints++; break;
      }
    }
  }

  return summary;
}

function rutaRelativa(ruta: string, rutaBase?: string): string {
  const normalizada = normalizarRuta(ruta);
  if (!rutaBase) {
    return normalizada;
  }

  const baseNormalizada = normalizarRuta(rutaBase).replace(/\/$/, '');
  return normalizada.startsWith(`${baseNormalizada}/`)
    ? normalizada.slice(baseNormalizada.length + 1)
    : normalizada;
}

function escaparTablaMarkdown(valor: string): string {
  return valor.replace(/\|/g, '\\|');
}

function ordenarEntradas(entries: CoreReportEntry[]): CoreReportEntry[] {
  return [...entries].sort((a, b) => {
    const erroresA = a.findings.filter(finding => finding.severity === 'error').length;
    const erroresB = b.findings.filter(finding => finding.severity === 'error').length;
    return erroresB - erroresA || b.findings.length - a.findings.length;
  });
}

/* [085A-2] Genera Markdown desde hallazgos core, sin filesystem ni VS Code.
 * Gotcha: CLI/LSP podran reutilizar este formato; los adaptadores solo escriben o muestran el resultado. */
export function generarReporteMarkdown(input: CoreWorkspaceReportInput): string {
  const fecha = (input.fecha ?? new Date()).toISOString().replace('T', ' ').substring(0, 19);
  const summary = calcularResumenReporte(input.entries);
  const lineas: string[] = [];

  lineas.push('# Code Sentinel - Reporte de Workspace\n');
  lineas.push(`**Fecha:** ${fecha}  `);
  lineas.push(`**Archivos analizados:** ${input.totalArchivos}  `);
  lineas.push(`**Archivos con violaciones:** ${input.entries.length}  `);
  lineas.push(`**Total violaciones:** ${summary.totalViolaciones}  \n`);

  lineas.push('| Severidad | Cantidad |');
  lineas.push('|-----------|----------|');
  lineas.push(`| Error | ${summary.totalErrores} |`);
  lineas.push(`| Warning | ${summary.totalWarnings} |`);
  lineas.push(`| Info | ${summary.totalInfo} |`);
  lineas.push(`| Hint | ${summary.totalHints} |\n`);

  if (summary.totalViolaciones === 0) {
    lineas.push('> Sin violaciones detectadas. El workspace esta limpio.');
  }

  for (const entrada of ordenarEntradas(input.entries)) {
    const ruta = rutaRelativa(entrada.ruta, input.rutaBase);

    lineas.push('---\n');
    lineas.push(`## ${ruta} (${entrada.findings.length} violaciones)\n`);
    lineas.push('| Linea | Severidad | Regla | Mensaje |');
    lineas.push('|-------|-----------|-------|---------|');

    const findings = [...entrada.findings].sort((a, b) => a.range.start.line - b.range.start.line);
    for (const finding of findings) {
      const linea = finding.range.start.line + 1;
      const severidad = severidadTextoCore(finding.severity);
      const regla = finding.ruleId || 'general';
      const mensaje = escaparTablaMarkdown(finding.message.split('\n')[0]);
      lineas.push(`| ${linea} | ${severidad} | ${regla} | ${mensaje} |`);
    }

    lineas.push('');
  }

  return lineas.join('\n');
}
