/*
 * [059A-S7] Reglas Rust nuevas del gate (plan saneamiento-calidad S7, decision D4).
 * Modulo aparte para no engordar rustAnalyzer.ts: cada regla con caso minimo y
 * no-disparo en src/test/suite/rustReglasNuevas.test.ts.
 *
 * - expect-produccion-rs (error): .expect(...) fuera de tests. Ampliacion de
 *   unwrap-produccion-rs (mismo riesgo: panic en produccion). Exento el
 *   constructor de clave HMAC, que no puede fallar (FP-S3 de 039A-1).
 * - block-en-async-rs (error): block_on dentro de codigo async. Evidencia real:
 *   panic "Cannot block the current thread from within a runtime" en
 *   cli/src/tui.rs:281 (Bloque 3 F1) corregido manualmente; la regla lo habria
 *   cazado en el gate.
 * - lock-a-traves-await-rs (warning): MutexGuard (std/tokio sync) viva a traves
 *   de .await en la misma funcion. Heuristica por rango: guard adquirido con
 *   .lock() (sin .await) antes de un .await sin drop previo.
 *
 * [149A-1] Segunda hornada (F1+F2, 9 reglas Rust; la decima, html, es TS y vive
 * en static/staticCodeRules.ts): rusqlite-bloqueante-en-async,
 * shell-modelo-sin-allowlist, secreto-en-log, ruta-post-sin-rate-limit,
 * path-join-sin-canonicalize, sqlite-carga-N-consultas, clone-bajo-lock-rs,
 * god-object-rs, port-fs-duplicado-rs. Cada detector documenta su caso real,
 * sus contraejemplos y sus limites conocidos (criterio H11: 0 FP en self-scan).
 */

import * as fs from 'fs';
import * as path from 'path';
import { Violacion } from '../types';
import { obtenerSeveridadRegla, reglaHabilitada } from '../config/ruleRegistry';
import { obtenerWorkspaceRoots, resolverWorkspaceRoot } from '../core/workspaceRoots';
import { contarLineasEfectivas } from '../utils/lineCounter';
import { esArchivoSoloTest } from './rustTestScope';

const REGLA_EXPECT = 'expect-produccion-rs';
const REGLA_BLOCK = 'block-en-async-rs';
const REGLA_LOCK_AWAIT = 'lock-a-traves-await-rs';

/* [149A-1] Ids de la segunda hornada (severidades en ruleRegistry.ts). */
const REGLA_SQLITE_MUTEX = 'rusqlite-bloqueante-en-async';
const REGLA_SHELL = 'shell-modelo-sin-allowlist';
const REGLA_SECRETO_LOG = 'secreto-en-log';
const REGLA_POST_SIN_RL = 'ruta-post-sin-rate-limit';
const REGLA_PATH_JOIN = 'path-join-sin-canonicalize';
const REGLA_N_CONSULTAS = 'sqlite-carga-N-consultas';
const REGLA_CLONE_LOCK = 'clone-bajo-lock-rs';
const REGLA_GOD_OBJECT = 'god-object-rs';
const REGLA_PORT_FS = 'port-fs-duplicado-rs';

function tieneDisableSiguiente(lineas: string[], i: number, reglaId: string): boolean {
  return i > 0 && lineas[i - 1].includes(`sentinel-disable-next-line ${reglaId}`);
}

/* Orquestador Pasos 7+8 de analizarRust(): primera hornada (059A-S7) y segunda
 * hornada (149A-1 F1+F2). Vive aqui —no en rustAnalyzer.ts— por el budget de
 * tamaño de ese modulo (ADR 0001). Orden preservado: el mismo que tenian los
 * Pasos 7 y 8 inline. */
export function analizarReglasNuevas(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
  fileName: string,
): Violacion[] {
  const violaciones: Violacion[] = [];
  if (reglaHabilitada(REGLA_EXPECT)) {
    violaciones.push(...detectarExpect(lineas, rangoTests, texto));
  }
  if (reglaHabilitada(REGLA_BLOCK)) {
    violaciones.push(...detectarBlockEnAsync(lineas, rangoTests, texto));
  }
  if (reglaHabilitada(REGLA_LOCK_AWAIT)) {
    violaciones.push(...detectarLockATravesAwait(lineas, rangoTests, texto));
  }
  if (reglaHabilitada(REGLA_SQLITE_MUTEX)) {
    violaciones.push(...detectarMutexSqliteEnAsync(lineas, rangoTests, texto));
  }
  if (reglaHabilitada(REGLA_SHELL)) {
    violaciones.push(...detectarShellSinAllowlist(lineas, rangoTests, texto));
  }
  if (reglaHabilitada(REGLA_SECRETO_LOG)) {
    violaciones.push(...detectarSecretoEnLog(lineas, rangoTests, texto));
  }
  if (reglaHabilitada(REGLA_POST_SIN_RL)) {
    violaciones.push(...detectarPostSinRateLimit(lineas, rangoTests, texto, fileName));
  }
  if (reglaHabilitada(REGLA_PATH_JOIN)) {
    violaciones.push(...detectarPathJoinSinCanonicalize(lineas, rangoTests, texto));
  }
  if (reglaHabilitada(REGLA_N_CONSULTAS)) {
    violaciones.push(...detectarCargaNConsultas(lineas, rangoTests, texto));
  }
  if (reglaHabilitada(REGLA_CLONE_LOCK)) {
    violaciones.push(...detectarCloneBajoLock(lineas, rangoTests, texto));
  }
  if (reglaHabilitada(REGLA_GOD_OBJECT)) {
    violaciones.push(...detectarGodObject(lineas, rangoTests, texto));
  }
  if (reglaHabilitada(REGLA_PORT_FS)) {
    violaciones.push(...detectarPortFsDuplicado(lineas, rangoTests, texto, fileName));
  }
  return violaciones;
}

/* ------------------------------------------------------------------ */
/* expect-produccion-rs                                                */
/* ------------------------------------------------------------------ */

/* [039A-1 FP-S3] Constructor de clave HMAC: inalcanzable, no es un panic real.
 *
 * `Hmac<D>` implementa `KeyInit::new_from_slice` devolviendo `Ok` SIEMPRE: HMAC
 * (RFC 2104) normaliza la clave de cualquier longitud (la hashea si excede el
 * bloque, la rellena con ceros si es corta), asi que `InvalidLength` no puede
 * darse. El `.expect(..)` que lo acompania es honesto y correcto.
 *
 * NO se exime `new_from_slice` en general: en AES-GCM/ChaCha20 SI puede fallar
 * por longitud invalida, y ahi el `.expect(..)` es un panic real. Por eso el
 * patron exige un tipo HMAC explicito delante del constructor. */
const RECEPTOR_HMAC = /\b(?:Simple)?Hmac[A-Za-z0-9_]*\b[\s\S]{0,80}?\bnew_from_slice\s*\(/;

/* El `.expect(..)` puede ir en la misma linea que el constructor o en la
 * siguiente (continuacion empezando por `.`), que es como se escribe en el
 * codigo real: por eso se mira hacia atras una vez. */
function caeEnConstructorHmac(lineas: string[], i: number, columna: number): boolean {
  const antes = lineas[i].slice(0, columna);
  if (RECEPTOR_HMAC.test(antes)) { return true; }
  if (antes.trim() !== '' && antes.trim() !== '.') { return false; }

  for (let k = i - 1; k >= 0 && k >= i - 4; k--) {
    const previa = lineas[k].trim();
    if (previa === '' || previa.startsWith('//') || previa.startsWith('*')) { continue; }
    return RECEPTOR_HMAC.test(lineas[k]);
  }
  return false;
}

export function detectarExpect(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_EXPECT}`)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }

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
      if (caeEnConstructorHmac(lineas, i, match.index)) { continue; }
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

/* Devuelve el set de lineas dentro de los parentesis de una llamada a
 * spawn_blocking: ahi el bloqueo ya esta aislado del runtime async (es el
 * fix que recomiendan rusqlite-bloqueante-rs y lock-a-traves-await-rs).
 * Balance de parentesis desde la linea de la llamada (el closure vive
 * dentro); vale tanto para `spawn_blocking(|| { ... })` como para
 * `spawn_blocking(|| expr)` sin llaves. */
function calcularRangosSpawnBlocking(lineas: string[]): Set<number> {
  const rangos = new Set<number>();
  const patronInicio = /spawn_blocking\s*\(/;

  let dentro = false;
  let profundidad = 0;
  let inicio = 0;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (!dentro && patronInicio.test(linea)) {
      dentro = true;
      inicio = i;
      profundidad = 0;
    }

    if (dentro) {
      rangos.add(i);
      for (const ch of linea) {
        if (ch === '(') { profundidad++; }
        if (ch === ')') {
          profundidad--;
          if (profundidad <= 0 && i > inicio) {
            dentro = false;
            break;
          }
        }
      }
      /* Llamada de una sola linea (balance 0 en la propia linea de
       * inicio): cerrar sin tragar el resto del fichero. */
      if (dentro && i === inicio && profundidad <= 0) {
        dentro = false;
      }
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
  if (esArchivoSoloTest(texto)) { return []; }

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
 * Mutex<Connection>, TODO .lock() sincrono en async se flaggea. Waiver:
 * sentinel-disable-next-line / sentinel-disable-file. */
const PATRON_MUTEX_CONNECTION = /Mutex\s*<\s*(?:[\w:]+\s*::\s*)*Connection\s*>/;
const PATRON_LOCK_SINCRONO_SUELTO = /\.lock\s*\(\s*\)(?!\s*\.await)/g;

export function detectarMutexSqliteEnAsync(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_SQLITE_MUTEX}`)) { return []; }
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

/* ------------------------------------------------------------------ */
/* [149A-1] shell-modelo-sin-allowlist (error)                         */
/* ------------------------------------------------------------------ */

/* Caso real: coolify-manager-rs infra/git.rs (Command::new("git") + args de
 * rama/remota). Solo se flaggea shell interactivo (cmd/sh/bash/powershell)
 * con ALGUN argumento no literal en la cadena (.arg/.args hasta 5 lineas).
 * Contraejemplo (no dispara): git.rs:385 — binario concreto con args
 * literales. Limite: no hay taint real; el flujo desde `comando: &str` se
 * documenta como limite, no como hallazgo.
 * Precision H11 (harness 2026-09-14): la regla se llama "sin-allowlist"
 * pero nunca comprobaba si HAY uno — jaula.rs valida BUILTINS_CMD.contains
 * + filtro de metacaracteres en la misma funcion y disparaba igual. Si el
 * scope de la funcion menciona un modelo allowlist EN CODIGO (no en
 * comentarios), el Command::new queda exento. Limite: no se exige orden
 * check-antes-de-uso dentro del scope. */
const PATRON_COMMAND_NEW = /Command::new\s*\(\s*"([^"]*)"\s*\)/g;
const SHELLS_INTERACTIVOS = new Set(['cmd', 'sh', 'bash', 'powershell', 'pwsh']);
const PATRON_MODELO_ALLOWLIST = /allowlist|allow_list|lista_blanca|BUILTINS|PERMITID|comandos_permitidos/i;

/* Lineas dentro de funciones cuyo codigo menciona un modelo allowlist. */
function lineasConAllowlist(lineas: string[], rangoTests: Set<number>): Set<number> {
  const exentas = new Set<number>();
  for (const [inicio, fin] of rangosFunciones(lineas, rangoTests)) {
    let hayModelo = false;
    for (let i = inicio; i <= fin && !hayModelo; i++) {
      const trimmed = lineas[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
      if (PATRON_MODELO_ALLOWLIST.test(lineas[i])) { hayModelo = true; }
    }
    if (hayModelo) {
      for (let i = inicio; i <= fin; i++) { exentas.add(i); }
    }
  }
  return exentas;
}

export function detectarShellSinAllowlist(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_SHELL}`)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }

  const violaciones: Violacion[] = [];
  const exentasAllowlist = lineasConAllowlist(lineas, rangoTests);

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }
    if (exentasAllowlist.has(i)) { continue; }
    const linea = lineas[i];
    const trimmed = linea.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
    if (tieneDisableSiguiente(lineas, i, REGLA_SHELL)) { continue; }
    if (linea.includes(`sentinel-disable ${REGLA_SHELL}`)) { continue; }

    let match: RegExpExecArray | null;
    PATRON_COMMAND_NEW.lastIndex = 0;
    while ((match = PATRON_COMMAND_NEW.exec(linea)) !== null) {
      if (!SHELLS_INTERACTIVOS.has(match[1].toLowerCase())) { continue; }

      let sospechoso = false;
      for (let k = i; k < Math.min(i + 6, lineas.length) && !sospechoso; k++) {
        const frag = k === i ? lineas[k].slice(match.index) : lineas[k];
        const reArg = /\.args?\s*\(/g;
        let mArg: RegExpExecArray | null;
        while ((mArg = reArg.exec(frag)) !== null) {
          const resto = frag.slice(mArg.index + mArg[0].length);
          /* Literal ("...") o array literal (&[...]) = argumento fijo: ok. */
          if (!/^\s*"/.test(resto) && !/^\s*&\s*\[/.test(resto)) {
            sospechoso = true;
            break;
          }
        }
      }

      if (sospechoso) {
        violaciones.push({
          reglaId: REGLA_SHELL,
          mensaje: `Command::new("${match[1]}") con argumento no literal: inyeccion de comandos si el valor viene de input externo. Fijar allowlist de comandos/argumentos.`,
          severidad: obtenerSeveridadRegla(REGLA_SHELL),
          linea: i,
          columna: match.index,
          columnaFin: match.index + match[0].length,
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/* ------------------------------------------------------------------ */
/* [149A-1] secreto-en-log (error)                                     */
/* ------------------------------------------------------------------ */

/* Caso real: coolify-manager-rs application/daemon.rs:285 (token en log).
 * Solo macros CON argumentos (el valor se interpola); un literal sin args
 * ("token expired") no dispara: eso es trabajo de hardcoded-secret. */
const PATRON_MACRO_LOG = /(?:println!|print!|eprintln!|eprint!|tracing::(?:error|warn|info|debug|trace)!|log::(?:error|warn|info|debug|trace)!)\s*\(/;
const PATRON_PALABRA_SECRETA = /token|secret|password|passwd|bearer|api[_-]?key/i;
/* Precision H11 (harness 2026-09-14): dos FP. (1) La coma que separa args
 * debe estar FUERA de literales: `eprintln!("... sin token, solo ...")`
 * tiene coma dentro del mensaje pero no interpola nada. Se vacian los
 * literales antes de buscar la coma. (2) `tokens_before/tokens_after/...`
 * son contadores, no secretos: se excluyen como sufijos de metrica. */
const PATRON_METRICA_TOKENS = /tokens?_(before|after|total|count|used|remaining|prompt|complecion|completion|input|output|read|write|limit|max)\b/i;
const PATRON_MACRO_CON_ARGS = /\([^)]*,/;

function lineaSinLiterales(linea: string): string {
  return linea.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

export function detectarSecretoEnLog(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_SECRETO_LOG}`)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }

  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }
    const linea = lineas[i];
    const trimmed = linea.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
    if (tieneDisableSiguiente(lineas, i, REGLA_SECRETO_LOG)) { continue; }
    if (linea.includes(`sentinel-disable ${REGLA_SECRETO_LOG}`)) { continue; }

    if (!PATRON_MACRO_LOG.test(linea)) { continue; }
    if (!PATRON_PALABRA_SECRETA.test(linea)) { continue; }
    if (PATRON_METRICA_TOKENS.test(linea)) { continue; }
    if (!PATRON_MACRO_CON_ARGS.test(lineaSinLiterales(linea))) { continue; }

    violaciones.push({
      reglaId: REGLA_SECRETO_LOG,
      mensaje: 'Posible secreto interpolado en log (token/secret/password/Bearer/api_key con argumentos). Los logs rotan a disco y a agregadores: redactar o hashear antes de emitir.',
      severidad: obtenerSeveridadRegla(REGLA_SECRETO_LOG),
      linea: i,
      fuente: 'estatico',
    });
  }

  return violaciones;
}

/* ------------------------------------------------------------------ */
/* [149A-1] ruta-post-sin-rate-limit (error)                           */
/* ------------------------------------------------------------------ */

/* Caso real: integracion web/mod.rs:457-499 (42 POST sin limite).
 * Supuesto documentado: stack axum + tower_governor. Exenciones (en orden):
 * 1) el fichero menciona governor/RateLimit/rate_limit/tower::limit;
 * 2) el Cargo.toml del proyecto declara governor (cache por directorio).
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
  cacheRateLimitToml.set(dirInicio, resultado);
  return resultado;
}

export function detectarPostSinRateLimit(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
  rutaArchivo?: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_POST_SIN_RL}`)) { return []; }
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

/* ------------------------------------------------------------------ */
/* [149A-1] path-join-sin-canonicalize (error)                         */
/* ------------------------------------------------------------------ */

/* Caso real: comandos/memoria.rs:417 (join sobre base sin canonicalize).
 * Alcance por funcion (reutiliza rangosFunciones): si el scope contiene
 * canonicalize(), TODO el scope queda exento. Codigo fuera de funciones
 * (inicializadores de modulo) no se cubre: limite documentado.
 * Precision H11 (harness 2026-09-14): dos ajustes. (1) Un hallazgo por
 * linea como maximo (antes un push por cada .join(: L436/L132/L76/L200/L27
 * salian duplicados). (2) Solo args NO literales: `v.join("\n")`
 * (String::join), `temp_dir().join("glory-harness")` o `.join(".git")` no
 * pueden hacer traversal — el segmento es fijo. El caso real une una
 * variable. Residual: `.join(format!(...))` con args calculados sigue
 * flaggeando (el mensaje es condicional: "si un segmento viene de input
 * externo"). (3) `join(CONSTANTE)` exento: una constante de modulo es valor
 * fijo auditable, no input externo (taint: las consts no son sources) —
 * cubre CARPETA_PROYECTO/MANIFIESTO_NOMBRE/CARPETA en harness. */
const PATRON_JOIN = /\.join\s*\(/g;
const PATRON_ARG_SOLO_LITERALES = /^\s*("(?:[^"\\]|\\.)*"\s*,?\s*)+$/;
const PATRON_ARG_SOLO_CONSTANTE = /^\s*&?\s*(?:[A-Za-z_][A-Za-z0-9_]*::)*[A-Z][A-Z0-9_]*\s*$/;

/* Extrae el texto entre el parentesis que abre en (i, colParen) y su cierre
 * balanceado (hasta +4 lineas para joins multilinea). null si no cierra. */
function textoArgsJoin(lineas: string[], i: number, colParen: number): string | null {
  let balance = 0;
  let empezo = false;
  let texto = '';
  for (let k = i; k < Math.min(i + 5, lineas.length); k++) {
    const frag = k === i ? lineas[k].slice(colParen) : lineas[k];
    for (const ch of frag) {
      texto += ch;
      if (ch === '(') { balance++; empezo = true; }
      else if (ch === ')') {
        balance--;
        if (empezo && balance === 0) {
          return texto.slice(1, -1);
        }
      }
    }
  }
  return null;
}

export function detectarPathJoinSinCanonicalize(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_PATH_JOIN}`)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }
  if (!PATRON_JOIN.test(texto)) { return []; }

  const violaciones: Violacion[] = [];

  for (const [inicio, fin] of rangosFunciones(lineas, rangoTests)) {
    let tieneCanonicalize = false;
    for (let j = inicio; j <= fin; j++) {
      if (lineas[j].includes('canonicalize')) { tieneCanonicalize = true; break; }
    }
    if (tieneCanonicalize) { continue; }

    for (let i = inicio; i <= fin; i++) {
      const linea = lineas[i];
      const trimmed = linea.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
      if (tieneDisableSiguiente(lineas, i, REGLA_PATH_JOIN)) { continue; }
      if (linea.includes(`sentinel-disable ${REGLA_PATH_JOIN}`)) { continue; }

      let match: RegExpExecArray | null;
      let sospechoso: { index: number; len: number } | null = null;
      PATRON_JOIN.lastIndex = 0;
      while ((match = PATRON_JOIN.exec(linea)) !== null && sospechoso === null) {
        const colParen = match.index + match[0].length - 1;
        const args = textoArgsJoin(lineas, i, colParen);
        /* Sin cierre visible o con algun arg no literal ni constante: revisar.
         * El join exento (literales/const) NO corta el escaneo: la linea
         * puede encadenar `base.join(C).join(variable)`. */
        if (args === null) {
          sospechoso = { index: match.index, len: match[0].length };
        } else if (!PATRON_ARG_SOLO_LITERALES.test(args) && !PATRON_ARG_SOLO_CONSTANTE.test(args)) {
          sospechoso = { index: match.index, len: match[0].length };
        }
      }
      if (sospechoso !== null) {
        violaciones.push({
          reglaId: REGLA_PATH_JOIN,
          mensaje: 'Path.join() sin canonicalize() + starts_with() en el scope: traversal si un segmento viene de input externo. Canonicalizar y validar el prefijo.',
          severidad: obtenerSeveridadRegla(REGLA_PATH_JOIN),
          linea: i,
          columna: sospechoso.index,
          columnaFin: sospechoso.index + sospechoso.len,
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/* ------------------------------------------------------------------ */
/* [149A-1] sqlite-carga-N-consultas (warning)                         */
/* ------------------------------------------------------------------ */

/* Caso real: web_datos/conversaciones.rs:125-137 (docenas de queries en
 * bucle). Heuristica honesta: >=3 .await SOBRE PERSISTENCIA en la misma
 * funcion sin join!/try_join/JoinSet en el scope. Sin tipos no se sabe si
 * un await es una query: se cuentan los statements con .await cuyo texto
 * menciona persistencia (db/pool/conn/sql/query/...) — `ejecutar_git().await`
 * o `sleep().await` no cuentan. El mensaje sigue siendo condicional ("si
 * son consultas"). Una violacion por funcion, en la linea del tercer await.
 * Precision H11 (harness 2026-09-14): antes contaba TODO await (git.rs,
 * scheduler, cron daban warning sin tocar persistencia). El statement se
 * acumula hasta ';' para cazar cadenas multilinea (`.persistencia`
 * ... `.await` en lineas distintas). */
const UMBRAL_AWAITS_SECUENCIALES = 3;
const PATRON_AWAIT = /\.await\b/;
const PATRON_JOIN_ASYNC = /\bjoin!|try_join|JoinSet|join_all|futures::/;
const PATRON_PERSISTENCIA = /persistencia|\bdb\b|_db\b|pool|\bconn\b|connection|sqlite|sqlx|diesel|rusqlite|sea_orm|\bquery\b|query_|stmt|repositor|\bdao\b|mongo|postgres|supabase|surreal/i;

export function detectarCargaNConsultas(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_N_CONSULTAS}`)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }
  if (!PATRON_AWAIT.test(texto)) { return []; }

  const violaciones: Violacion[] = [];

  for (const [inicio, fin] of rangosFunciones(lineas, rangoTests)) {
    const scope = lineas.slice(inicio, fin + 1).join('\n');
    if (PATRON_JOIN_ASYNC.test(scope)) { continue; }

    const lineasAwait: number[] = [];
    let stmt = '';
    let stmtInicio = inicio;
    let stmtTieneDisable = false;
    const cerrarStmt = (cierre: number): void => {
      if (!stmtTieneDisable && PATRON_AWAIT.test(stmt) && PATRON_PERSISTENCIA.test(stmt)) {
        /* Linea del ultimo .await del statement. */
        for (let s = cierre; s >= stmtInicio; s--) {
          if (PATRON_AWAIT.test(lineas[s])) {
            if (!lineasAwait.includes(s)) { lineasAwait.push(s); }
            break;
          }
        }
      }
      stmt = '';
      stmtInicio = cierre + 1;
      stmtTieneDisable = false;
    };

    for (let i = inicio; i <= fin; i++) {
      const trimmed = lineas[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
      if (tieneDisableSiguiente(lineas, i, REGLA_N_CONSULTAS)) { stmtTieneDisable = true; }
      if (lineas[i].includes(`sentinel-disable ${REGLA_N_CONSULTAS}`)) { stmtTieneDisable = true; }
      if (stmt === '') { stmtInicio = i; }
      stmt += (stmt === '' ? '' : '\n') + lineas[i];
      if (lineas[i].includes(';')) { cerrarStmt(i); }
    }
    if (stmt !== '') { cerrarStmt(fin); }

    lineasAwait.sort((a, b) => a - b);
    if (lineasAwait.length >= UMBRAL_AWAITS_SECUENCIALES) {
      const tercera = lineasAwait[UMBRAL_AWAITS_SECUENCIALES - 1];
      violaciones.push({
        reglaId: REGLA_N_CONSULTAS,
        mensaje: `${lineasAwait.length} .await sobre persistencia en la misma funcion sin join!/try_join (caso real conversaciones.rs:125-137). Si son consultas independientes, agrupar con join! o paginar.`,
        severidad: obtenerSeveridadRegla(REGLA_N_CONSULTAS),
        linea: tercera,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

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
  if (texto.includes(`sentinel-disable-file ${REGLA_CLONE_LOCK}`)) { return []; }
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

export function detectarGodObject(
  lineas: string[],
  _rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_GOD_OBJECT}`)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }

  let tieneCodigo = false;
  for (const linea of lineas) {
    const trimmed = linea.trim();
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#')) { continue; }
    if (!LINEA_SOLO_REEXPORT.test(linea)) { tieneCodigo = true; break; }
  }
  if (!tieneCodigo) { return []; }

  const efectivas = contarLineasEfectivas(texto, true);
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

/* ------------------------------------------------------------------ */
/* [149A-1] port-fs-duplicado-rs (warning, pasada workspace)           */
/* ------------------------------------------------------------------ */

/* Casos reales: persistencia_sqlite duplicado en 2 crates (coolify).
 * Ambito SOLO .rs (frontera con duplicado-cross-crate de varsense, que es
 * solo estilos/tokens). Jaccard >0.8 sobre lineas normalizadas con minimo
 * 20 lineas: debajo de eso, cualquier helper pequeno matchearia.
 * Fail-closed sin workspace roots (patron proyectoTieneModalCanonico).
 * Waiver documentado: linea con 'diverge de' (divergencia intencional).
 * Topes: 30 candidatos, 2000 lineas por candidato, cache por root. */
const UMBRAL_SIMILITUD_FS = 0.8;
const MIN_LINEAS_FS = 20;
const MAX_CANDIDATOS_FS = 30;
const MAX_LINEAS_CANDIDATO_FS = 2000;
const DIRS_EXCLUIDOS_FS = new Set(['target', 'node_modules', '.git', 'tests', 'examples', 'out', 'dist', '.sentinel']);
const cacheCandidatosFs = new Map<string, string[]>();

function conjuntoLineasFs(texto: string): Set<string> {
  const conjunto = new Set<string>();
  for (const linea of texto.split('\n')) {
    const t = linea.trim();
    if (t === '' || t.startsWith('//') || t.startsWith('*')) { continue; }
    conjunto.add(t);
  }
  return conjunto;
}

function jaccardFs(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) { return 0; }
  let interseccion = 0;
  for (const x of a) { if (b.has(x)) { interseccion++; } }
  return interseccion / (a.size + b.size - interseccion);
}

function listarRsWorkspace(root: string): string[] {
  const cached = cacheCandidatosFs.get(root);
  if (cached) { return cached; }

  const resultado: string[] = [];
  const pendientes: string[] = [root];
  while (pendientes.length > 0 && resultado.length < MAX_CANDIDATOS_FS) {
    const dir = pendientes.pop() as string;
    let entradas: import('fs').Dirent[];
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      const ruta = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!DIRS_EXCLUIDOS_FS.has(e.name)) { pendientes.push(ruta); }
      } else if (e.isFile() && e.name.endsWith('.rs')) {
        resultado.push(ruta.replace(/\\/g, '/'));
      }
      if (resultado.length >= MAX_CANDIDATOS_FS) { break; }
    }
  }
  cacheCandidatosFs.set(root, resultado);
  return resultado;
}

export function detectarPortFsDuplicado(
  _lineas: string[],
  _rangoTests: Set<number>,
  texto: string,
  rutaArchivo?: string,
): Violacion[] {
  if (texto.includes(`sentinel-disable-file ${REGLA_PORT_FS}`)) { return []; }
  if (/\bdiverge de\b/i.test(texto)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }
  if (!rutaArchivo) { return []; }

  const roots = obtenerWorkspaceRoots();
  if (roots.length === 0) { return []; }
  const root = resolverWorkspaceRoot(rutaArchivo);
  if (!root) { return []; }

  const propio = rutaArchivo.replace(/\\/g, '/');
  const mias = conjuntoLineasFs(texto);
  if (mias.size < MIN_LINEAS_FS) { return []; }

  const hallazgos: string[] = [];
  /* H11 (harness 2026-09-14): la exclusion del propio fichero se hace AQUI,
   * no en listarRsWorkspace. La cache es por root y se compartia entre
   * ficheros: el segundo fichero analizado se comparaba consigo mismo
   * (similitud 100% con su propia ruta). */
  for (const candidato of listarRsWorkspace(root)) {
    if (candidato === propio) { continue; }
    let contenido: string;
    try {
      contenido = fs.readFileSync(candidato, 'utf8');
    } catch {
      continue;
    }
    if (esArchivoSoloTest(contenido)) { continue; }
    const otras = conjuntoLineasFs(contenido.split('\n').slice(0, MAX_LINEAS_CANDIDATO_FS).join('\n'));
    const sim = jaccardFs(mias, otras);
    if (sim > UMBRAL_SIMILITUD_FS) {
      const rel = path.relative(root, candidato).replace(/\\/g, '/');
      hallazgos.push(`${rel} (${Math.round(sim * 100)}%)`);
      if (hallazgos.length >= 3) { break; }
    }
  }
  if (hallazgos.length === 0) { return []; }

  return [{
    reglaId: REGLA_PORT_FS,
    mensaje: `Contenido duplicado con otro crate del workspace (similitud >80%): ${hallazgos.join('; ')}. Extraer a crate comun o documentar '// diverge de X porque …'.`,
    severidad: obtenerSeveridadRegla(REGLA_PORT_FS),
    linea: 0,
    fuente: 'estatico',
  }];
}
