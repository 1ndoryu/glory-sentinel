/*
 * Resolucion del stack axum/matchit del workspace para la regla
 * `axum-ruta-sintaxis-rs` (version-aware; caso 069A-2).
 *
 * - matchit 0.7 (axum 0.7): sintaxis `:param`.
 * - matchit 0.8 (axum 0.8+): sintaxis `{param}`.
 * - Sin evidencia (sin Cargo.lock/Cargo.toml con el stack): `desconocida`
 *   y la regla conserva el legacy (flaggear `{param}`, caso 297A-14).
 *
 * La version se lee del Cargo.lock subiendo desde el fichero del documento
 * (matchit primero, axum como respaldo; Cargo.toml como ultimo recurso),
 * con cache por directorio de inicio.
 */

import * as fs from 'fs';
import * as path from 'path';

export type SintaxisAxum = 'nueva' | 'antigua' | 'desconocida';

export interface StackAxum {
  sintaxis: SintaxisAxum;
  matchit: string | null;
  axum: string | null;
}

const cacheStackAxum = new Map<string, StackAxum>();

function versionPaqueteLock(contenido: string, nombre: string): string | null {
  const lineas = contenido.split('\n');
  for (let i = 0; i + 1 < lineas.length; i++) {
    if (lineas[i].trim() === `name = "${nombre}"`) {
      const m = lineas[i + 1].trim().match(/^version = "([^"]+)"/);
      if (m) {
        return m[1];
      }
    }
  }
  return null;
}

function versionAxumToml(contenido: string | null): string | null {
  if (!contenido) {
    return null;
  }
  const m = contenido.match(/^\s*axum\s*=\s*(?:"([^"]+)"|\{\s*version\s*=\s*"([^"]+)")/m);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/* matchit/axum 0.7 vs 0.8 difieren en el MINOR (major 0 en ambos):
 * `nueva` = 0.8+ (o major >= 1 futuro). */
function esSintaxisNueva(version: string | null): boolean | null {
  if (!version) {
    return null;
  }
  const m = version.trim().replace(/^[^\d]*/, '').match(/^(\d+)\.(\d+)/);
  if (!m) {
    return null;
  }
  const mayor = parseInt(m[1], 10);
  const menor = parseInt(m[2], 10);
  return mayor >= 1 || (mayor === 0 && menor >= 8);
}

function stackDesdeLockToml(lock: string | null, toml: string | null): StackAxum | null {
  const matchit = lock ? versionPaqueteLock(lock, 'matchit') : null;
  const axum = (lock ? versionPaqueteLock(lock, 'axum') : null) ?? versionAxumToml(toml);
  const porMatchit = esSintaxisNueva(matchit);
  if (porMatchit !== null) {
    return {
      sintaxis: porMatchit ? 'nueva' : 'antigua',
      matchit,
      axum,
    };
  }
  const porAxum = esSintaxisNueva(axum);
  if (porAxum !== null) {
    return {
      sintaxis: porAxum ? 'nueva' : 'antigua',
      matchit,
      axum,
    };
  }
  return null;
}

export function detectarStackAxum(rutaArchivo: string): StackAxum {
  const dirInicio = path.dirname(rutaArchivo.replace(/\\/g, '/'));
  const cached = cacheStackAxum.get(dirInicio);
  if (cached) {
    return cached;
  }
  let resultado: StackAxum = { sintaxis: 'desconocida', matchit: null, axum: null };
  let dir = dirInicio;
  for (let nivel = 0; nivel < 8; nivel++) {
    let lock: string | null = null;
    let toml: string | null = null;
    try {
      const rutaLock = path.join(dir, 'Cargo.lock');
      if (fs.existsSync(rutaLock)) {
        lock = fs.readFileSync(rutaLock, 'utf8');
      }
    } catch {
      /* lock ilegible: se sigue subiendo */
    }
    try {
      const rutaToml = path.join(dir, 'Cargo.toml');
      if (fs.existsSync(rutaToml)) {
        toml = fs.readFileSync(rutaToml, 'utf8');
      }
    } catch {
      /* toml ilegible: se sigue subiendo */
    }
    const stack = stackDesdeLockToml(lock, toml);
    if (stack) {
      resultado = stack;
      break;
    }
    const padre = path.dirname(dir);
    if (padre === dir) {
      break;
    }
    dir = padre;
  }
  cacheStackAxum.set(dirInicio, resultado);
  return resultado;
}
