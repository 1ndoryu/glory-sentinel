/*
 * Helpers compartidos para los analyzers de Code Sentinel.
 * Centraliza patrones repetidos: skip de comentarios, sentinel-disable,
 * exclusion Glory/, hash de contenido, etc.
 * Reduce boilerplate en ~30 funciones de reglas.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CoreTextDocument } from '../core/types';

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
/* [119A-4 S7] /glory-core/ es codigo del framework: sus <button>/<input>
 * nativos SON los componentes que las reglas piden usar, asi que se exime
 * igual que /Glory/. */
export function esRutaGlory(ruta: string): boolean {
  const normalizada = ruta.replace(/\\/g, '/');
  return normalizada.includes('/Glory/') || normalizada.includes('/glory-core/');
}

/*
 * Calcula hash MD5 del contenido.
 * Usado por debounceService y cacheService para detectar cambios.
 */
export function calcularHash(contenido: string): string {
  return crypto.createHash('md5').update(contenido).digest('hex');
}

/* [119A-4 S4] Clases canonicas del sistema Modal que las reglas
 * modal-*-no-canonica presuponen. Si el proyecto no define ninguna, sugerir
 * "usa modalAcciones/modalTexto/..." es un falso positivo: no hay sistema. */
const CLASES_MODAL_CANONICAS_BUSQUEDA = /\.modal(?:Acciones|Formulario|Campo|Titulo|Texto)\b/;
const DIRS_MODAL_SKIP = new Set([
  'node_modules', 'vendor', 'dist', 'build', '.git', 'coverage',
  '.quality-tools', '.sentinel', '.quality-reports', 'target',
]);
const cacheModalCanonico = new Map<string, boolean>();

function contieneClaseModalCanonica(dir: string): boolean {
  let entries: import('fs').Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (DIRS_MODAL_SKIP.has(entry.name)) { continue; }
    const ruta = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (contieneClaseModalCanonica(ruta)) { return true; }
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      let texto: string;
      try {
        texto = fs.readFileSync(ruta, 'utf8');
      } catch {
        continue;
      }
      if (CLASES_MODAL_CANONICAS_BUSQUEDA.test(texto)) { return true; }
    }
  }
  return false;
}

/*
 * [119A-4 S4] Retorna true si el proyecto define al menos una clase canonica
 * de Modal (.modalAcciones/.modalFormulario/.modalCampo/.modalTitulo/.modalTexto).
 * Fail-closed: sin roots configurados no se puede afirmar la ausencia, asi que
 * retorna true (las reglas siguen disparando como antes). Resultado con cache
 * por conjunto de roots; el recorrido para en el primer CSS con coincidencia.
 */
export function proyectoTieneModalCanonico(roots: string[]): boolean {
  const normalizados = roots.map(r => r.replace(/\\/g, '/').replace(/\/+$/, '')).filter(Boolean);
  if (normalizados.length === 0) { return true; }
  const clave = normalizados.join('|');
  const cached = cacheModalCanonico.get(clave);
  if (cached !== undefined) { return cached; }
  const tiene = normalizados.some(root => contieneClaseModalCanonica(root));
  cacheModalCanonico.set(clave, tiene);
  return tiene;
}

/*
 * Extrae las lineas de texto de un documento VS Code.
 */
export function obtenerLineas(documento: CoreTextDocument): string[] {
  return documento.getText().split('\n');
}

/*
 * Normaliza una ruta reemplazando backslashes por forward slashes.
 */
export function normalizarRuta(ruta: string): string {
  return ruta.replace(/\\/g, '/');
}
