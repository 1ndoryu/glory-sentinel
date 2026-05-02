/*
 * Helpers compartidos para los analyzers de Code Sentinel.
 * Centraliza patrones repetidos: skip de comentarios, sentinel-disable,
 * exclusion Glory/, hash de contenido, etc.
 * Reduce boilerplate en ~30 funciones de reglas.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';

/*
 * Retorna true si la linea es un comentario (PHP, JS/TS, CSS).
 * Cubre: //, #, /*, *, docblocks (/**).
 */
export function esComentario(linea: string): boolean {
  const trim = linea.trim();
  return (
    trim.startsWith('//') ||
    trim.startsWith('*') ||
    trim.startsWith('/*') ||
    trim.startsWith('#')
  );
}

/* Retorna true si el bloque de comentario que precede inmediatamente a la linea
 * contiene `sentinel-disable-next-line <reglaId>`. Escanea hacia atras a traves
 * de lineas vacias y lineas de comentario (/* ... * ... *\/  // ...) para soportar
 * comentarios multi-linea como:
 *   /* sentinel-disable-next-line rule
 *    * razon explicativa *\/
 *   codigo-que-dispara-la-regla
 * [25A-SENT-FP] Fix falsos positivos por disable comments de 2+ lineas. */
export function tieneSentinelDisable(lineas: string[], indice: number, reglaId: string): boolean {
  for (let k = indice - 1; k >= 0 && k >= indice - 5; k--) {
    const linea = lineas[k] ?? '';
    if (linea.includes(`sentinel-disable-next-line ${reglaId}`)) { return true; }
    const trimmed = linea.trim();
    /* Si no es parte de un bloque de comentario, parar la busqueda */
    if (trimmed !== '' &&
        !trimmed.startsWith('/*') && !trimmed.startsWith('*') &&
        !trimmed.startsWith('//') && !trimmed.endsWith('*/')) {
      break;
    }
  }
  return false;
}

/*
 * Retorna true si la ruta pertenece al framework Glory/
 * (que tiene su propia arquitectura y no debe analizarse con reglas del proyecto).
 */
export function esRutaGlory(ruta: string): boolean {
  const normalizada = ruta.replace(/\\/g, '/');
  return normalizada.includes('/Glory/');
}

/*
 * Calcula hash MD5 del contenido.
 * Usado por debounceService y cacheService para detectar cambios.
 */
export function calcularHash(contenido: string): string {
  return crypto.createHash('md5').update(contenido).digest('hex');
}

/*
 * Extrae las lineas de texto de un documento VS Code.
 */
export function obtenerLineas(documento: vscode.TextDocument): string[] {
  return documento.getText().split('\n');
}

/*
 * Normaliza una ruta reemplazando backslashes por forward slashes.
 */
export function normalizarRuta(ruta: string): string {
  return ruta.replace(/\\/g, '/');
}
