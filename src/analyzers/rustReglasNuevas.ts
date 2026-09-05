/*
 * [059A-S7] Reglas Rust nuevas del gate (plan saneamiento-calidad S7, decision D4).
 * Modulo aparte para no engordar rustAnalyzer.ts: cada regla con caso minimo y
 * no-disparo en src/test/suite/rustReglasNuevas.test.ts.
 *
 * - expect-produccion-rs (error): .expect(...) fuera de tests. Ampliacion de
 *   unwrap-produccion-rs (mismo riesgo: panic en produccion).
 * - block-en-async-rs (error): block_on dentro de codigo async. Evidencia real:
 *   panic "Cannot block the current thread from within a runtime" en
 *   cli/src/tui.rs:281 (Bloque 3 F1) corregido manualmente; la regla lo habria
 *   cazado en el gate.
 * - lock-a-traves-await-rs (warning): MutexGuard (std/tokio sync) viva a traves
 *   de .await en la misma funcion. Heuristica por rango: guard adquirido con
 *   .lock() (sin .await) antes de un .await sin drop previo.
 */

import { Violacion } from '../types';
import { reglaHabilitada, obtenerSeveridadRegla } from '../config/ruleRegistry';

const REGLA_EXPECT = 'expect-produccion-rs';
const REGLA_BLOCK = 'block-en-async-rs';
const REGLA_LOCK_AWAIT = 'lock-a-traves-await-rs';

function tieneDisableSiguiente(lineas: string[], i: number, reglaId: string): boolean {
  return i > 0 && lineas[i - 1].includes(`sentinel-disable-next-line ${reglaId}`);
}

/* ------------------------------------------------------------------ */
/* expect-produccion-rs                                                */
/* ------------------------------------------------------------------ */

export function detectarExpect(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_EXPECT}`)) { return []; }

  const violaciones: Violacion[] = [];
  const patron = /\.expect\s*\(/g;

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }

    const linea = lineas[i];
    const trimmed = linea.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
    if (tieneDisableSiguiente(lineas, i, REGLA_EXPECT)) { continue; }
    if (linea.includes(`sentinel-disable ${REGLA_EXPECT}`)) { continue; }

    let match: RegExpExecArray | null;
    patron.lastIndex = 0;
    while ((match = patron.exec(linea)) !== null) {
      violaciones.push({
        reglaId: REGLA_EXPECT,
        mensaje: '.expect(...) en codigo de produccion: panic si la condicion falla. Usar ? o manejo explicito del error.',
        severidad: obtenerSeveridadRegla(REGLA_EXPECT),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* ------------------------------------------------------------------ */
/* block-en-async-rs                                                   */
/* ------------------------------------------------------------------ */

/* Devuelve el set de lineas que caen dentro del cuerpo de una funcion
 * async (fn, closure async move/async {}) o de un #[tokio::main]/#[tokio::test]
 * (main/test async). Heuristica por llaves; suficiente para el gate. */
function calcularRangosAsync(lineas: string[]): Set<number> {
  const rangos = new Set<number>();
  const patronInicioAsync = /(?:^|\s)(?:async\s+(?:fn|move)|async\s*\{)|#\[(?:tokio|async_std)::(?:main|test)\]/;

  let dentro = false;
  let profundidad = 0;
  let inicio = 0;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (!dentro && patronInicioAsync.test(linea)) {
      /* Saltar la propia linea de declaracion: el cuerpo empieza en la { */
      dentro = true;
      inicio = i;
      profundidad = 0;
    }

    if (dentro) {
      for (const ch of linea) {
        if (ch === '{') { profundidad++; }
        if (ch === '}') {
          profundidad--;
          if (profundidad <= 0 && i > inicio) {
            dentro = false;
            break;
          }
        }
      }
      if (dentro) { rangos.add(i); }
    }
  }

  return rangos;
}

export function detectarBlockEnAsync(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_BLOCK}`)) { return []; }

  const rangosAsync = calcularRangosAsync(lineas);
  const violaciones: Violacion[] = [];
  const patron = /(?:\.|::)block_on\s*\(|futures::executor::block_on\s*\(/g;

  for (let i = 0; i < lineas.length; i++) {
    /* Solo dentro de contexto async y fuera de tests */
    if (!rangosAsync.has(i)) { continue; }
    if (rangoTests.has(i)) { continue; }

    const linea = lineas[i];
    const trimmed = linea.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
    if (tieneDisableSiguiente(lineas, i, REGLA_BLOCK)) { continue; }
    if (linea.includes(`sentinel-disable ${REGLA_BLOCK}`)) { continue; }

    let match: RegExpExecArray | null;
    patron.lastIndex = 0;
    while ((match = patron.exec(linea)) !== null) {
      violaciones.push({
        reglaId: REGLA_BLOCK,
        mensaje: 'block_on() dentro de contexto async: panic "Cannot block the current thread from within a runtime" (caso real tui.rs:281). Reestructurar para await directo.',
        severidad: obtenerSeveridadRegla(REGLA_BLOCK),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* ------------------------------------------------------------------ */
/* lock-a-traves-await-rs (heuristica por rango)                       */
/* ------------------------------------------------------------------ */

interface GuardActivo {
  nombre: string;
  profundidad: number;
  linea: number;
}

/* Regresa [inicio, fin] (indices inclusivos) de cada cuerpo de funcion
 * no-test detectado, reutilizando la heuristica de analizarFunciones. */
function rangosFunciones(lineas: string[], rangoTests: Set<number>): Array<[number, number]> {
  const rangos: Array<[number, number]> = [];
  const patronFn = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+\w+\s*(?:<[^>]*>)?\s*\(/;

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }
    if (!patronFn.test(lineas[i])) { continue; }

    let profundidad = 0;
    let abrio = false;
    let fin = -1;
    for (let j = i; j < lineas.length; j++) {
      for (const ch of lineas[j]) {
        if (ch === '{') { abrio = true; profundidad++; }
        if (ch === '}') {
          profundidad--;
          if (profundidad === 0 && abrio) { fin = j; break; }
        }
      }
      if (fin !== -1) { break; }
    }
    if (fin !== -1) { rangos.push([i, fin]); i = fin; }
  }

  return rangos;
}

const PATRON_LOCK_SYNC = /let\s+(\w+)\s*=\s*[^;\n]*?\.lock\s*\(\s*\)(?!\s*\.await)/;

export function detectarLockATravesAwait(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_LOCK_AWAIT}`)) { return []; }

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
