/* [M-S11] Lectura compartida del Cargo.toml de un directorio. Las reglas de rutas y el
 * detector de stack Axum recorren los mismos ancestros: sin caché, cada fichero Rust
 * releía los mismos archivos. Se registra en cachesModulo para vaciarse al recargar. */
import * as fs from 'fs';
import * as path from 'path';
import { registrarCacheModulo } from '../../utils/analisis/cachesModulo';

const cacheCargoToml = registrarCacheModulo(new Map<string, string | null>());

/* Contenido del Cargo.toml de `dir`, o null si no existe o no se puede leer (se sigue subiendo). */
export function leerCargoToml(dir: string): string | null {
  const ruta = path.join(dir, 'Cargo.toml');
  if (cacheCargoToml.has(ruta)) { return cacheCargoToml.get(ruta) ?? null; }

  let contenido: string | null = null;
  try {
    if (fs.existsSync(ruta)) { contenido = fs.readFileSync(ruta, 'utf8'); }
  } catch {
    /* ilegible: se trata como ausente */
  }
  cacheCargoToml.set(ruta, contenido);
  return contenido;
}
