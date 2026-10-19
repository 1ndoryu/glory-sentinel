import { Violacion } from '../types';
import { obtenerSeveridadRegla } from '../config/ruleRegistry';
import { tieneSentinelDisableFile } from '../utils/analisisHelpers';
import { esArchivoSoloTest } from './rustTestScope';
import { REGLA_SHELL, REGLA_SECRETO_LOG, tieneDisableSiguiente, rangosFunciones } from './rustReglasCompartidas';

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
  if (tieneSentinelDisableFile(texto, REGLA_SHELL)) { return []; }
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
  if (tieneSentinelDisableFile(texto, REGLA_SECRETO_LOG)) { return []; }
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
