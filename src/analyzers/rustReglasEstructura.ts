import { Violacion } from '../types';
import { obtenerSeveridadRegla } from '../config/ruleRegistry';
import { contarLineasEfectivas } from '../utils/lineCounter';
import { tieneSentinelDisableFile } from '../utils/analisisHelpers';
import { esArchivoSoloTest } from './rustTestScope';
import {
  REGLA_CLONE_LOCK, REGLA_GOD_OBJECT, tieneDisableSiguiente, GuardActivo, rangosFunciones, PATRON_LOCK_SYNC,
} from './rustReglasCompartidas';

/* ------------------------------------------------------------------ */
/* [149A-1] clone-bajo-lock-rs (warning)                               */
/* ------------------------------------------------------------------ */

/* Casos reales: application/scheduler.rs:66, web_datos/mod.rs:98
 * (`.clone()` de datos bajo Mutex, copia cara en cada tick/request).
 * Regla hermana de lock-a-traves-await-rs: aquella dispara en la linea del
 * .await, esta en la linea del .clone() — lineas distintas, sin doble
 * marcado (cubierto por test). `Arc::clone(&x)` no matchea `x.clone(`:
 * exento por construccion. Una violacion por guard y funcion. */
export function detectarCloneBajoLock(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, REGLA_CLONE_LOCK)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }
  if (!/\.clone\s*\(/.test(texto)) { return []; }

  const violaciones: Violacion[] = [];

  for (const [inicio, fin] of rangosFunciones(lineas, rangoTests)) {
    let activos: GuardActivo[] = [];
    let profundidad = 0;

    for (let i = inicio; i <= fin; i++) {
      const linea = lineas[i];
      const trimmed = linea.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }

      let maxProfundidad = profundidad;
      for (const ch of linea) {
        if (ch === '{') {
          profundidad++;
          maxProfundidad = Math.max(maxProfundidad, profundidad);
        }
        if (ch === '}') {
          profundidad--;
          activos = activos.filter(g => g.profundidad <= profundidad);
        }
      }

      if (tieneDisableSiguiente(lineas, i, REGLA_CLONE_LOCK)) { continue; }
      if (linea.includes(`sentinel-disable ${REGLA_CLONE_LOCK}`)) { continue; }

      const matchLock = PATRON_LOCK_SYNC.exec(linea);
      if (matchLock) {
        activos.push({ nombre: matchLock[1], profundidad: maxProfundidad, linea: i });
      }

      const matchDrop = /\bdrop\s*\(\s*(\w+)\s*\)/.exec(linea);
      if (matchDrop) {
        activos = activos.filter(g => g.nombre !== matchDrop[1]);
      }

      for (const g of [...activos]) {
        const patronClone = new RegExp(`\\b${g.nombre}\\s*\\.\\s*clone\\s*\\(`);
        if (patronClone.test(linea)) {
          violaciones.push({
            reglaId: REGLA_CLONE_LOCK,
            mensaje: `.clone() de '${g.nombre}' bajo lock sincrono (adquirido linea ${g.linea + 1}): copia cara dentro de la seccion critica. Clonar fuera del lock o usar Arc::clone(&...) para compartir ownership.`,
            severidad: obtenerSeveridadRegla(REGLA_CLONE_LOCK),
            linea: i,
            fuente: 'estatico',
          });
          activos = activos.filter(x => x.nombre !== g.nombre);
          break;
        }
      }

      activos = activos.filter(g => g.profundidad <= profundidad);
    }
  }

  return violaciones;
}

/* ------------------------------------------------------------------ */
/* [149A-1] god-object-rs (warning >500, error >800 efectivas)         */
/* ------------------------------------------------------------------ */

/* Casos reales: web_datos/mod.rs (1760L), web/mod.rs (1625L).
 * Exento mod.rs solo-reexport (todas las lineas de codigo son mod/use).
 * Severidad: base por umbral; el default del registro es 'warning' y es
 * ambiguo con un override explicito a 'warning', asi que ante default manda
 * el umbral y cualquier override no-warning manda siempre (limite
 * documentado del contrato obtenerSeveridadRegla). */
const UMBRAL_GOD_WARN = 500;
const UMBRAL_GOD_ERROR = 800;
const LINEA_SOLO_REEXPORT = /^\s*(pub(\([^)]*\))?\s+)?(mod|use)\s+[\w:*{}, ]+;?\s*$/;

/* [16A-9] Un atributo es metadato de compilacion, no comportamiento: el
 * `#[openapi(paths(...), components(schemas(...)))]` de utoipa es un registro
 * de datos, no logica que partir. Mismo principio que la exencion de
 * mod.rs-solo-reexport ("no cuenta lo que no es codigo").
 * Caso real `handlers/openapi.rs`: 645 lineas, 602 dentro de atributos; sin
 * ellos quedan ~43. Los god-object reales no tienen atributos de ese tamano,
 * asi que su recuento no cambia.
 * Limite documentado: los corchetes dentro de un literal de un atributo
 * desajustarian el balance. */
function sinAtributos(texto: string): string {
  const lineas = texto.split('\n');
  let corchetes = 0;
  for (let i = 0; i < lineas.length; i++) {
    if (corchetes === 0) {
      if (!/^\s*#!?\[/.test(lineas[i])) { continue; }
      /* `#[cfg(test)]` se conserva: `contarLineasEfectivas` lo usa para
       * truncar el modulo de tests. */
      if (lineas[i].includes('#[cfg(test)]')) { continue; }
    }
    for (const ch of lineas[i]) {
      if (ch === '[') { corchetes++; } else if (ch === ']') { corchetes--; }
    }
    lineas[i] = '';
  }
  return lineas.join('\n');
}

export function detectarGodObject(
  lineas: string[],
  _rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, REGLA_GOD_OBJECT)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }

  let tieneCodigo = false;
  for (const linea of lineas) {
    const trimmed = linea.trim();
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#')) { continue; }
    if (!LINEA_SOLO_REEXPORT.test(linea)) { tieneCodigo = true; break; }
  }
  if (!tieneCodigo) { return []; }

  const efectivas = contarLineasEfectivas(sinAtributos(texto), true);
  if (efectivas <= UMBRAL_GOD_WARN) { return []; }

  const base = efectivas > UMBRAL_GOD_ERROR ? 'error' : 'warning';
  const configurada = obtenerSeveridadRegla(REGLA_GOD_OBJECT);
  const severidad = configurada === 'warning' && base === 'error' ? 'error' : configurada;

  return [{
    reglaId: REGLA_GOD_OBJECT,
    mensaje: `Archivo god-object: ${efectivas} lineas efectivas (warning >${UMBRAL_GOD_WARN}, error >${UMBRAL_GOD_ERROR}). Partir por dominio (handlers/services/repos).`,
    severidad,
    linea: 0,
    fuente: 'estatico',
  }];
}
