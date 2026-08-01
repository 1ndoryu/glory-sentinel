import { Violacion } from '../types';
import { CoreFinding, CoreTextDocument, createCoreRange } from './types';

const FUENTE_ESTATICO = 'Code Sentinel';

export function violacionToCoreFinding(violacion: Violacion, document: CoreTextDocument): CoreFinding {
  const lineaInicio = Math.max(0, Math.min(violacion.linea, document.lineCount - 1));
  const lineaFin = violacion.lineaFin !== undefined
    ? Math.max(0, Math.min(violacion.lineaFin, document.lineCount - 1))
    : lineaInicio;

  const colInicio = violacion.columna ?? Math.max(0, document.lineAt(lineaInicio).text.search(/\S/));
  const colFin = violacion.columnaFin ?? document.lineAt(lineaFin).text.length;

  return {
    ruleId: violacion.reglaId,
    message: violacion.mensaje,
    severity: violacion.severidad,
    range: createCoreRange(lineaInicio, colInicio, lineaFin, colFin),
    source: FUENTE_ESTATICO,
    suggestion: violacion.sugerencia,
    remediation: violacion.sugerencia,
    confidence: violacion.severidad === 'error' ? 0.95 : violacion.severidad === 'warning' ? 0.8 : 0.6,
    analyzerVersion: 'sentinel-core-0.4',
    quickFixId: violacion.quickFixId,
  };
}

export function violacionesToCoreFindings(
  violaciones: Violacion[],
  document: CoreTextDocument,
): CoreFinding[] {
  return violaciones.map(violacion => violacionToCoreFinding(violacion, document));
}
