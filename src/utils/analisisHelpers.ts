/*
 * Helpers compartidos para los analyzers de Code Sentinel.
 * Centraliza patrones repetidos: skip de comentarios, sentinel-disable,
 * exclusion Glory/, hash de contenido, etc.
 * Reduce boilerplate en ~30 funciones de reglas.
 */

export { esComentario, tieneSentinelDisable, tieneSentinelDisableFile } from './analisis/sentinelDisable';
export { esRutaGlory, calcularHash, obtenerLineas, normalizarRuta } from './analisis/rutasYContenido';
export { proyectoTieneModalCanonico, sufijoSemanticoModal, claseCanonicaModal, bloqueDefineSemanticaModal } from './analisis/modalCanonico';
export { IndiceProyecto } from './analisis/indiceTipos';
export { claseAplicada } from './analisis/indiceAlias';
export { indiceProyecto } from './analisis/indiceProyecto';
export { enmascararLiterales } from './analisis/literalesCodigo';
