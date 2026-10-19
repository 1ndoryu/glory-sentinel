import * as fs from 'fs';
import * as path from 'path';
import { Violacion } from '../types';
import { obtenerSeveridadRegla } from '../config/ruleRegistry';
import { tieneSentinelDisableFile } from '../utils/analisisHelpers';
import { esArchivoSoloTest } from './rustTestScope';
import { REGLA_POST_SIN_RL, tieneDisableSiguiente } from './rustReglasCompartidas';

/* ------------------------------------------------------------------ */
/* [149A-1] ruta-post-sin-rate-limit (error)                           */
/* ------------------------------------------------------------------ */

/* Caso real: integracion web/mod.rs:457-499 (42 POST sin limite).
 * Supuesto documentado: stack axum + tower_governor. Exenciones (en orden):
 * 1) el fichero menciona governor/RateLimit/rate_limit/tower::limit;
 * 2) el Cargo.toml del proyecto declara governor (cache por directorio);
 * 3) [08AA-26][10AA-10] un enrutador del fichero o de un directorio ancestro
 *    (hasta la raiz del crate) aplica `rate_limit::` dentro de una capa
 *    tower: el fichero de rutas no necesita mencionar el limite.
 * Sin evidencia se flaggea: el fallo abierto por defecto es peor que el FP,
 * y el waiver es sentinel-disable-file. */
const PATRON_POST_ROUTE = /\.route\s*\(\s*"[^"]*"\s*,\s*[^)]*?\bpost\s*\(/;
const cacheRateLimitToml = new Map<string, boolean>();

function proyectoConRateLimit(texto: string, rutaArchivo?: string): boolean {
  if (/governor|RateLimit|rate_limit|tower::limit/i.test(texto)) { return true; }
  if (!rutaArchivo) { return false; }

  const dirInicio = path.dirname(rutaArchivo.replace(/\\/g, '/'));
  const cached = cacheRateLimitToml.get(dirInicio);
  if (cached !== undefined) { return cached; }

  let resultado = false;
  let dir = dirInicio;
  for (let nivel = 0; nivel < 4 && !resultado; nivel++) {
    try {
      const rutaToml = path.join(dir, 'Cargo.toml');
      if (fs.existsSync(rutaToml)) {
        const toml = fs.readFileSync(rutaToml, 'utf8');
        resultado = /governor/i.test(toml);
      }
    } catch {
      /* toml ilegible: se sigue subiendo */
    }
    const padre = path.dirname(dir);
    if (padre === dir) { break; }
    dir = padre;
  }
  /* [08AA-26] (3) limite cableado como capa de un enrutador ancestro: vive en
   * el router, no como mencion en cada fichero. */
  if (!resultado) {
    resultado = rateLimitCableadoEnAncestro(dirInicio);
  }
  cacheRateLimitToml.set(dirInicio, resultado);
  return resultado;
}

/* [08AA-26][10AA-10] Sube desde el directorio del fichero (hasta 4 niveles y
 * sin pasar del dir con Cargo.toml) buscando un enrutador que aplique el
 * limite: `rate_limit::` + `from_fn`/`GovernorLayer` en mod/main/lib/web.rs.
 * Exige que exista el modulo `rate_limit` en ese ancestro o bajo el: el
 * limitador puede vivir en un hermano (handlers/cuentas/rate_limit.rs) y
 * cablearse en handlers/mod.rs. Caso MN src/handlers/ 2026-10-08: 21 rutas
 * POST marcadas con el limite aplicado globalmente via
 * from_fn_with_state(capa_limite). Un enrutador hermano NO exime: su capa no
 * cubre el subarbol ajeno. Un `mod rate_limit;` muerto (sin uso ni capa)
 * tampoco. Fail-closed sin evidencia. */
function rateLimitCableadoEnAncestro(dirInicio: string): boolean {
  let dir = dirInicio.replace(/\\/g, '/');
  for (let nivel = 0; nivel < 4; nivel++) {
    if (enrutadorAplicaRateLimit(dir) && existeModuloRateLimit(dir, 3)) { return true; }
    if (fs.existsSync(path.join(dir, 'Cargo.toml'))) { break; }
    const padre = path.dirname(dir);
    if (padre === dir) { break; }
    dir = padre;
  }
  return false;
}

function enrutadorAplicaRateLimit(dir: string): boolean {
  for (const candidato of ['mod.rs', 'main.rs', 'lib.rs', 'web.rs']) {
    let contenido = '';
    try {
      contenido = fs.readFileSync(path.join(dir, candidato), 'utf8');
    } catch {
      continue;
    }
    if (/rate_limit::/.test(contenido) && /from_fn|GovernorLayer/.test(contenido)) { return true; }
  }
  return false;
}

/* Omite artefactos grandes para no recorrer target/ ni node_modules/ al
 * buscar el modulo bajo la raiz del crate. */
const DIRS_OMITIDOS_RL = new Set(['target', 'node_modules', '.git', 'dist', 'out']);

function existeModuloRateLimit(dir: string, profundidad: number): boolean {
  if (fs.existsSync(path.join(dir, 'rate_limit.rs')) || fs.existsSync(path.join(dir, 'rate_limit', 'mod.rs'))) { return true; }
  if (profundidad <= 0) { return false; }
  let entradas: fs.Dirent[] = [];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entradas.some(e =>
    e.isDirectory() && !DIRS_OMITIDOS_RL.has(e.name) &&
    existeModuloRateLimit(path.join(dir, e.name), profundidad - 1));
}

export function detectarPostSinRateLimit(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
  rutaArchivo?: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, REGLA_POST_SIN_RL)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }
  if (!/\.route\s*\(/.test(texto)) { return []; }
  if (proyectoConRateLimit(texto, rutaArchivo)) { return []; }

  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }
    const linea = lineas[i];
    const trimmed = linea.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
    if (tieneDisableSiguiente(lineas, i, REGLA_POST_SIN_RL)) { continue; }
    if (linea.includes(`sentinel-disable ${REGLA_POST_SIN_RL}`)) { continue; }

    const match = PATRON_POST_ROUTE.exec(linea);
    if (match) {
      violaciones.push({
        reglaId: REGLA_POST_SIN_RL,
        mensaje: 'Ruta POST sin rate limiting visible (sin governor/RateLimit en el fichero ni en el Cargo.toml). Supuesto: axum + tower_governor. Anadir limite o waiver con sentinel-disable-file.',
        severidad: obtenerSeveridadRegla(REGLA_POST_SIN_RL),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
