/*
 * Reglas de estructura y calidad de codigo para el analyzer estatico.
 * Detecta: limites de lineas, useState excesivo, imports muertos,
 * any type explicito, non-null assertion excesivo.
 */

export {
  REGLAS_LIMITE_LINEAS,
  verificarLimiteLineas,
  verificarUseStateExcesivo,
} from './reglasCodigo/limitesYUseState';
export {
  verificarImportsMuertos,
  verificarAnyType,
  verificarNonNullAssertion,
} from './reglasCodigo/importsYTipos';
export {
  invalidarCacheDirectorios,
  verificarDirectorioAbarrotado,
} from './reglasCodigo/directorioAbarrotado';
export { verificarHtmlSinOrigenDeclarado } from './reglasCodigo/htmlSinOrigen';
export { verificarTodoProsaSinMarcador } from './reglasCodigo/todoProsa';
