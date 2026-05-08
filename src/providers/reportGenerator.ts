/*
 * Generador de reportes markdown para analisis de workspace.
 * Extrae la responsabilidad de reporte del diagnosticProvider
 * para cumplir SRP y mantener archivos bajo 300 lineas.
 */

import * as vscode from 'vscode';
import { logInfo, logWarn } from '../utils/logger';
import { generarReporteMarkdown, severidadTextoCore } from '../core/report';
import { diagnosticSeverityToSeverity, diagnosticToFinding } from '../core/vscodeAdapter';

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
  const entries = Array.from(resultados.values()).map(entrada => ({
    ruta: entrada.ruta,
    findings: entrada.diagnosticos.map(diagnosticToFinding),
  }));

  const contenido = generarReporteMarkdown({
    entries,
    totalArchivos,
    rutaBase,
  });
  const totalViolaciones = entries.reduce((total, entrada) => total + entrada.findings.length, 0);

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
  return severidadTextoCore(diagnosticSeverityToSeverity(severity));
}
