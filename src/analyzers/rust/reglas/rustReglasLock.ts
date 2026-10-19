import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { esArchivoSoloTest } from '../rustTestScope';
import {
  REGLA_LOCK_AWAIT, REGLA_SQLITE_MUTEX, tieneDisableSiguiente, PATRON_LOCK_SYNC,
  GuardActivo, rangosFunciones, calcularRangosAsync, calcularRangosSpawnBlocking,
} from './rustReglasCompartidas';

/* ------------------------------------------------------------------ */
/* lock-a-traves-await-rs (heuristica por rango)                       */
/* ------------------------------------------------------------------ */

export function detectarLockATravesAwait(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, REGLA_LOCK_AWAIT)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }

  const violaciones: Violacion[] = [];

  for (const [inicio, fin] of rangosFunciones(lineas, rangoTests)) {
    let activos: GuardActivo[] = [];
    let profundidad = 0;

    for (let i = inicio; i <= fin; i++) {
      const linea = lineas[i];
      const trimmed = linea.trim();

      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }

      /* Ajustar profundidad de bloque y descartar guards cuyo bloque cerro.
       * maxProfundidad: profundidad maxima de la linea (para binds dentro de
       * bloques de una sola linea, p. ej. `{ let g = m.lock(); ... }`). */
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

      if (tieneDisableSiguiente(lineas, i, REGLA_LOCK_AWAIT)) { continue; }
      if (linea.includes(`sentinel-disable ${REGLA_LOCK_AWAIT}`)) { continue; }

      /* Guard recien adquirido con lock sincrono (recordado a la profundidad
       * de su bloque textual, no a la del final de linea) */
      const matchLock = PATRON_LOCK_SYNC.exec(linea);
      if (matchLock) {
        activos.push({ nombre: matchLock[1], profundidad: maxProfundidad, linea: i });
      }

      /* drop explicito libera el guard */
      const matchDrop = /\bdrop\s*\(\s*(\w+)\s*\)/.exec(linea);
      if (matchDrop) {
        activos = activos.filter(g => g.nombre !== matchDrop[1]);
      }

      /* Await con un guard sincrono activo = riesgo de bloqueo del runtime */
      if (activos.length > 0 && /\.await\b/.test(linea)) {
        const nombres = activos.map(g => g.nombre).join(', ');
        violaciones.push({
          reglaId: REGLA_LOCK_AWAIT,
          mensaje: `MutexGuard sincrono (${nombres}) vivo a traves de .await (linea ${i + 1}). Puede bloquear el runtime o panickear en futures Send. Acotar el scope del guard o usar tokio::sync::Mutex.`,
          severidad: obtenerSeveridadRegla(REGLA_LOCK_AWAIT),
          linea: i,
          fuente: 'estatico',
        });
        activos = [];
      }

      /* Purga fin-de-linea: si el bloque textual del guard cerro en esta linea
       * (p. ej. bind dentro de un bloque de una sola linea), descartarlo. */
      activos = activos.filter(g => g.profundidad <= profundidad);
    }
  }

  return violaciones;
}

/* ------------------------------------------------------------------ */
/* [149A-1] rusqlite-bloqueante-en-async (error)                       */
/* ------------------------------------------------------------------ */

/* Caso real: coolify-manager-rs persistencia_sqlite/puerto.rs:26 —
 * `self.conn.lock()` con conn: Mutex<Connection> (rusqlite es sincrono;
 * bajo tokio el lock bloquea el worker entero).
 * Limite conocido (H11): no se resuelven tipos; si el fichero declara
 * Mutex<Connection>, cualquier .lock() sincrono en async se flaggea. Waiver:
 * sentinel-disable-next-line / sentinel-disable-file. */
const PATRON_MUTEX_CONNECTION = /Mutex\s*<\s*(?:[\w:]+\s*::\s*)*Connection\s*>/;
const PATRON_LOCK_SINCRONO_SUELTO = /\.lock\s*\(\s*\)(?!\s*\.await)/g;

export function detectarMutexSqliteEnAsync(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, REGLA_SQLITE_MUTEX)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }
  if (!PATRON_MUTEX_CONNECTION.test(texto)) { return []; }

  const rangosAsync = calcularRangosAsync(lineas);
  /* H11 (harness 2026-09-14): el .lock() YA migrado a spawn_blocking es el
   * patron recomendado por el propio mensaje — flaggearlo castiga el fix
   * (caso persistencia_sqlite.rs:357). Se exime el scope del closure. */
  const rangosBlocking = calcularRangosSpawnBlocking(lineas);
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    if (!rangosAsync.has(i)) { continue; }
    if (rangosBlocking.has(i)) { continue; }
    if (rangoTests.has(i)) { continue; }

    const linea = lineas[i];
    const trimmed = linea.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
    if (tieneDisableSiguiente(lineas, i, REGLA_SQLITE_MUTEX)) { continue; }
    if (linea.includes(`sentinel-disable ${REGLA_SQLITE_MUTEX}`)) { continue; }

    let match: RegExpExecArray | null;
    PATRON_LOCK_SINCRONO_SUELTO.lastIndex = 0;
    while ((match = PATRON_LOCK_SINCRONO_SUELTO.exec(linea)) !== null) {
      violaciones.push({
        reglaId: REGLA_SQLITE_MUTEX,
        mensaje: 'Mutex<Connection> (rusqlite sincrono) con .lock() dentro de contexto async: bloquea el worker de tokio. Mover a spawn_blocking o a un pool async (caso real puerto.rs:26).',
        severidad: obtenerSeveridadRegla(REGLA_SQLITE_MUTEX),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
