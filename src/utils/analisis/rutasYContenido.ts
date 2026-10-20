/* Rutas Glory, hash de contenido y lectura de lineas del documento. Extraido de src/utils/analisisHelpers.ts (fachada). */
import { CoreTextDocument } from '../../core/runtime-proyecto/types';
import * as crypto from 'crypto';

/* [119A-4 S7] /glory-core/ es codigo del framework: sus <button>/<input>
 * nativos SON los componentes que las reglas piden usar, asi que se exime
 * igual que /Glory/. Un proyecto puede cambiar los marcadores en su config. */
export const MARCADORES_GLORY_DEFECTO: readonly string[] = ['/Glory/', '/glory-core/'];

/*
 * Retorna true si la ruta pertenece al framework Glory/
 * (que tiene su propia arquitectura y no debe analizarse con reglas del proyecto).
 * [M-S10] Los marcadores llegan como parámetro (config del proyecto); sin estado de módulo.
 */
export function esRutaGlory(ruta: string, marcadores: readonly string[] = MARCADORES_GLORY_DEFECTO): boolean {
  const normalizada = normalizarRuta(ruta);
  return marcadores.some(marcador => normalizada.includes(marcador));
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
export function obtenerLineas(documento: CoreTextDocument): string[] {
  return documento.getText().split('\n');
}

/*
 * Normaliza una ruta reemplazando backslashes por forward slashes.
 */
export function normalizarRuta(ruta: string): string {
  return ruta.replace(/\\/g, '/');
}
