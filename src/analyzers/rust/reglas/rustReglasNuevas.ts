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

import { Violacion } from '../../../types';
import { reglaHabilitada } from '../../../config/ruleRegistry';
import {
  REGLA_EXPECT, REGLA_BLOCK, REGLA_LOCK_AWAIT, REGLA_SQLITE_MUTEX, REGLA_SHELL, REGLA_SECRETO_LOG,
  REGLA_POST_SIN_RL, REGLA_PATH_JOIN, REGLA_N_CONSULTAS, REGLA_CLONE_LOCK, REGLA_GOD_OBJECT, REGLA_PORT_FS,
} from './rustReglasCompartidas';
import { detectarExpect, detectarBlockEnAsync } from './rustReglasExpectBlock';
import { detectarLockATravesAwait, detectarMutexSqliteEnAsync } from './rustReglasLock';
import { detectarShellSinAllowlist, detectarSecretoEnLog } from './rustReglasSeguridad';
import { detectarPostSinRateLimit } from './rustReglasRutas';
import { detectarPathJoinSinCanonicalize } from './rustReglasPathJoin';
import { detectarCargaNConsultas } from './rustReglasSqlite';
import { detectarCloneBajoLock, detectarGodObject } from './rustReglasEstructura';
import { detectarPortFsDuplicado } from './rustReglasPortFs';

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
