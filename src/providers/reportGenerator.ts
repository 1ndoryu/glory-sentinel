/*
 * Generador de reportes markdown para analisis de workspace.
 * Extrae la responsabilidad de reporte del diagnosticProvider
 * para cumplir SRP y mantener archivos bajo 300 lineas.
 */

import * as vscode from 'vscode';
import { logInfo, logWarn } from '../utils/logger';

/*
 * Genera un archivo markdown con el resumen de todas las violaciones
 * encontradas durante el analisis de workspace.
 */
export async function generarReporteWorkspace(
  resultados: Map<string, { ruta: string; diagnosticos: vscode.Diagnostic[] }>,
  totalArchivos: number
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) { return; }

  const config = vscode.workspace.getConfiguration('codeSentinel');
  const reportPath = config.get<string>('reportPath', '.sentinel-report.md');
  const rutaBase = workspaceFolders[0].uri.fsPath.replace(/\\/g, '/');

  /* Contadores por severidad */
  let totalErrores = 0;
  let totalWarnings = 0;
  let totalInfo = 0;
  let totalHints = 0;
  let totalViolaciones = 0;

  for (const [, entrada] of resultados) {
    for (const d of entrada.diagnosticos) {
      totalViolaciones++;
      switch (d.severity) {
        case vscode.DiagnosticSeverity.Error: totalErrores++; break;
        case vscode.DiagnosticSeverity.Warning: totalWarnings++; break;
        case vscode.DiagnosticSeverity.Information: totalInfo++; break;
        case vscode.DiagnosticSeverity.Hint: totalHints++; break;
      }
    }
  }

  const fecha = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let contenido = `# Code Sentinel - Reporte de Workspace\n\n`;
  contenido += `**Fecha:** ${fecha}  \n`;
  contenido += `**Archivos analizados:** ${totalArchivos}  \n`;
  contenido += `**Archivos con violaciones:** ${resultados.size}  \n`;
  contenido += `**Total violaciones:** ${totalViolaciones}  \n\n`;

  contenido += `| Severidad | Cantidad |\n`;
  contenido += `|-----------|----------|\n`;
  contenido += `| Error | ${totalErrores} |\n`;
  contenido += `| Warning | ${totalWarnings} |\n`;
  contenido += `| Info | ${totalInfo} |\n`;
  contenido += `| Hint | ${totalHints} |\n\n`;

  if (totalViolaciones === 0) {
    contenido += `> Sin violaciones detectadas. El workspace esta limpio.\n`;
  }

  /* Ordenar archivos: primero los que tienen mas errores */
  const archivosOrdenados = Array.from(resultados.entries())
    .sort((a, b) => {
      const erroresA = a[1].diagnosticos.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
      const erroresB = b[1].diagnosticos.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
      return erroresB - erroresA || b[1].diagnosticos.length - a[1].diagnosticos.length;
    });

  for (const [, entrada] of archivosOrdenados) {
    const rutaRelativa = entrada.ruta.replace(/\\/g, '/').replace(rutaBase + '/', '');

    contenido += `---\n\n`;
    contenido += `## ${rutaRelativa} (${entrada.diagnosticos.length} violaciones)\n\n`;
    contenido += `| Linea | Severidad | Regla | Mensaje |\n`;
    contenido += `|-------|-----------|-------|---------|\n`;

    const diagOrdenados = [...entrada.diagnosticos].sort((a, b) => a.range.start.line - b.range.start.line);

    for (const d of diagOrdenados) {
      const linea = d.range.start.line + 1;
      const severidad = severidadTexto(d.severity);
      const regla = d.code ?? 'general';
      const mensaje = d.message.split('\n')[0].replace(/\|/g, '\\|');
      contenido += `| ${linea} | ${severidad} | ${regla} | ${mensaje} |\n`;
    }

    contenido += `\n`;
  }

  /* Escribir archivo y abrirlo */
  try {
    const rutaReporte = vscode.Uri.joinPath(workspaceFolders[0].uri, reportPath);
    await vscode.workspace.fs.writeFile(rutaReporte, Buffer.from(contenido, 'utf-8'));
    const doc = await vscode.workspace.openTextDocument(rutaReporte);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    logInfo(`Reporte generado: ${reportPath} (${totalViolaciones} violaciones en ${resultados.size} archivos).`);
  } catch (error) {
    logWarn(`No se pudo generar reporte: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* Convierte DiagnosticSeverity a texto legible para reportes */
export function severidadTexto(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error: return 'Error';
    case vscode.DiagnosticSeverity.Warning: return 'Warning';
    case vscode.DiagnosticSeverity.Information: return 'Info';
    case vscode.DiagnosticSeverity.Hint: return 'Hint';
    default: return 'Unknown';
  }
}
