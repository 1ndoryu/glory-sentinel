/*
 * Motor de analisis estatico  Fachada.
 * Ejecuta reglas basadas en regex y delega verificaciones complejas
 * a static/staticCodeRules y static/staticCssRules.
 */

export type { StaticAnalysisOptions } from './analisis/staticOrquestador';
export { limpiarDirectoriosReportados, analizarEstatico } from './analisis/staticOrquestador';
export { tieneSentinelDisableFile } from './analisis/staticSentinelDisable';
