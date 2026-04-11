/*
 * [114A-6] Analyzer contextual para Rust.
 * Detecta violaciones SOLID y de seguridad que requieren contexto
 * mas alla de regex por linea: bloques #[cfg(test)], rutas de archivo,
 * conteo de lineas por funcion, conteo de parametros.
 *
 * Reglas implementadas:
 * - unwrap-produccion-rs: .unwrap() fuera de bloques test
 * - panic-produccion-rs: panic!/todo!/unimplemented! fuera de tests
 * - handler-accede-bd-rs: sqlx::query en handlers/ (viola DIP)
 * - funcion-larga-rs: funciones > 100 lineas efectivas
 * - parametros-excesivos-rs: funciones con 6+ parametros
 */

import * as vscode from 'vscode';
import { Violacion } from '../types';
import { reglaHabilitada, obtenerSeveridadRegla } from '../config/ruleRegistry';

/* Limite de lineas efectivas por funcion (clippy tambien lo verifica,
 * pero Sentinel lo muestra inline sin necesidad de compilar) */
const LIMITE_LINEAS_FUNCION = 100;

/* Maximo parametros antes de sugerir agrupar en struct */
const LIMITE_PARAMETROS = 5;

/* Ejecuta todas las reglas Rust contextuales sobre un documento .rs */
export function analizarRust(documento: vscode.TextDocument): Violacion[] {
  const texto = documento.getText();
  const lineas = texto.split('\n');
  const rutaNorm = documento.fileName.replace(/\\/g, '/');

  /* Excluir archivos de tests dedicados y examples */
  if (rutaNorm.includes('/examples/') || rutaNorm.includes('/tests/')) {
    return [];
  }

  /* Soporte sentinel-disable-file global para todo el analyzer */
  if (texto.includes('sentinel-disable-file rust-analyzer')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  /* Paso 1: Determinar que rangos de lineas son codigo de test.
   * Detecta #[cfg(test)] mod tests { ... } y funciones #[test]. */
  const rangoTests = calcularRangosTest(lineas);

  /* Paso 2: Reglas por linea con contexto test */
  if (reglaHabilitada('unwrap-produccion-rs')) {
    violaciones.push(...detectarUnwrap(lineas, rangoTests, texto));
  }

  if (reglaHabilitada('panic-produccion-rs')) {
    violaciones.push(...detectarPanic(lineas, rangoTests, texto));
  }

  /* Paso 3: Handler accede BD (solo para archivos en handlers/) */
  if (reglaHabilitada('handler-accede-bd-rs') && rutaNorm.includes('/handlers/')) {
    violaciones.push(...detectarHandlerAccedeBd(lineas, texto));
  }

  /* Paso 4: Funciones largas y parametros excesivos */
  if (reglaHabilitada('funcion-larga-rs') || reglaHabilitada('parametros-excesivos-rs')) {
    violaciones.push(...analizarFunciones(lineas, rangoTests, texto));
  }

  return violaciones;
}

/* Calcula rangos de lineas que pertenecen a bloques de test.
 * Detecta #[cfg(test)] seguido de mod, y funciones #[test].
 * Retorna un Set de indices de linea que son "test code". */
function calcularRangosTest(lineas: string[]): Set<number> {
  const rangos = new Set<number>();
  let dentroModTest = false;
  let profundidadLlaves = 0;
  let profundidadInicio = 0;

  for (let i = 0; i < lineas.length; i++) {
    const trimmed = lineas[i].trim();

    /* Detectar inicio de modulo test: #[cfg(test)] */
    if (trimmed === '#[cfg(test)]') {
      /* Marcar la linea del atributo y buscar el mod siguiente */
      rangos.add(i);
      dentroModTest = true;
      profundidadInicio = profundidadLlaves;
      continue;
    }

    if (dentroModTest) {
      rangos.add(i);

      /* Contar llaves para saber cuando termina el modulo */
      for (const ch of lineas[i]) {
        if (ch === '{') { profundidadLlaves++; }
        if (ch === '}') {
          profundidadLlaves--;
          if (profundidadLlaves <= profundidadInicio) {
            dentroModTest = false;
            break;
          }
        }
      }
    } else {
      /* Contar llaves globales para tracking correcto */
      for (const ch of lineas[i]) {
        if (ch === '{') { profundidadLlaves++; }
        if (ch === '}') { profundidadLlaves--; }
      }
    }
  }

  return rangos;
}

/* Detecta .unwrap() fuera de bloques test */
function detectarUnwrap(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes('sentinel-disable-file unwrap-produccion-rs')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const patron = /\.unwrap\(\)/g;

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }

    const linea = lineas[i];
    const trimmed = linea.trim();

    /* Saltar comentarios */
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    /* Saltar lineas con sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line unwrap-produccion-rs')) {
      continue;
    }
    if (linea.includes('sentinel-disable unwrap-produccion-rs')) {
      continue;
    }

    let match: RegExpExecArray | null;
    patron.lastIndex = 0;
    while ((match = patron.exec(linea)) !== null) {
      violaciones.push({
        reglaId: 'unwrap-produccion-rs',
        mensaje: '.unwrap() en codigo de produccion. Usar ? o .unwrap_or() para manejar el error.',
        severidad: obtenerSeveridadRegla('unwrap-produccion-rs'),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* Detecta panic!, todo!, unimplemented! fuera de bloques test */
function detectarPanic(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes('sentinel-disable-file panic-produccion-rs')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const patron = /\b(panic|todo|unimplemented)!\s*\(/g;

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }

    const linea = lineas[i];
    const trimmed = linea.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line panic-produccion-rs')) {
      continue;
    }
    if (linea.includes('sentinel-disable panic-produccion-rs')) {
      continue;
    }

    let match: RegExpExecArray | null;
    patron.lastIndex = 0;
    while ((match = patron.exec(linea)) !== null) {
      const macro = match[1];
      violaciones.push({
        reglaId: 'panic-produccion-rs',
        mensaje: `${macro}!() en codigo de produccion. Retornar error con ? en vez de abortar.`,
        severidad: obtenerSeveridadRegla('panic-produccion-rs'),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* Detecta sqlx::query directo en archivos de handlers/ (viola DIP) */
function detectarHandlerAccedeBd(
  lineas: string[],
  texto: string,
): Violacion[] {
  if (texto.includes('sentinel-disable-file handler-accede-bd-rs')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const patron = /sqlx::query(?:_as|_scalar)?[!]?\s*[(<:]/g;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const trimmed = linea.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line handler-accede-bd-rs')) {
      continue;
    }
    if (linea.includes('sentinel-disable handler-accede-bd-rs')) {
      continue;
    }

    let match: RegExpExecArray | null;
    patron.lastIndex = 0;
    while ((match = patron.exec(linea)) !== null) {
      violaciones.push({
        reglaId: 'handler-accede-bd-rs',
        mensaje: 'Query SQL directa en handler. Mover al repositorio correspondiente (DIP).',
        severidad: obtenerSeveridadRegla('handler-accede-bd-rs'),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* Analiza funciones: longitud y conteo de parametros.
 * Heuristica: busca `fn nombre(` y cuenta llaves hasta cerrar la funcion. */
function analizarFunciones(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  const violaciones: Violacion[] = [];
  const disableFnLarga = texto.includes('sentinel-disable-file funcion-larga-rs');
  const disableParams = texto.includes('sentinel-disable-file parametros-excesivos-rs');

  /* Regex para detectar inicio de funcion Rust (pub/pub(crate)/async etc) */
  const patronFn = /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/;

  let i = 0;
  while (i < lineas.length) {
    const match = patronFn.exec(lineas[i]);
    if (!match) {
      i++;
      continue;
    }

    /* Saltear funciones dentro de bloques test */
    if (rangoTests.has(i)) {
      i++;
      continue;
    }

    const lineaInicio = i;
    const nombreFn = match[2];

    /* Contar parametros: acumular desde ( hasta ) cruzando multiples lineas */
    if (!disableParams && reglaHabilitada('parametros-excesivos-rs')) {
      const numParams = contarParametros(lineas, i);
      if (numParams > LIMITE_PARAMETROS) {
        if (!(i > 0 && lineas[i - 1].includes('sentinel-disable-next-line parametros-excesivos-rs'))) {
          violaciones.push({
            reglaId: 'parametros-excesivos-rs',
            mensaje: `fn ${nombreFn}() tiene ${numParams} parametros (max ${LIMITE_PARAMETROS}). Agrupar en struct.`,
            severidad: obtenerSeveridadRegla('parametros-excesivos-rs'),
            linea: i,
            fuente: 'estatico',
          });
        }
      }
    }

    /* Contar longitud de la funcion: desde la linea fn hasta la } de cierre */
    if (!disableFnLarga && reglaHabilitada('funcion-larga-rs')) {
      const longitud = medirLongitudFuncion(lineas, i);
      if (longitud > LIMITE_LINEAS_FUNCION) {
        if (!(i > 0 && lineas[i - 1].includes('sentinel-disable-next-line funcion-larga-rs'))) {
          violaciones.push({
            reglaId: 'funcion-larga-rs',
            mensaje: `fn ${nombreFn}() tiene ${longitud} lineas efectivas (max ${LIMITE_LINEAS_FUNCION}). Dividir en funciones auxiliares.`,
            severidad: obtenerSeveridadRegla('funcion-larga-rs'),
            linea: lineaInicio,
            fuente: 'estatico',
          });
        }
      }
    }

    i++;
  }

  return violaciones;
}

/* Cuenta parametros de una funcion empezando en la linea donde aparece fn.
 * Acumula texto desde el primer ( hasta el ) correspondiente. */
function contarParametros(lineas: string[], inicio: number): number {
  let texto = '';
  let profundidad = 0;
  let encontroApertura = false;

  for (let i = inicio; i < Math.min(inicio + 30, lineas.length); i++) {
    const linea = lineas[i];

    for (const ch of linea) {
      if (ch === '(') {
        if (!encontroApertura) {
          encontroApertura = true;
          profundidad = 1;
          continue;
        }
        profundidad++;
      } else if (ch === ')') {
        profundidad--;
        if (profundidad === 0 && encontroApertura) {
          return contarComasNivel0(texto);
        }
      }

      if (encontroApertura && profundidad > 0) {
        texto += ch;
      }
    }

    if (encontroApertura) { texto += '\n'; }
  }

  return 0;
}

/* Cuenta parametros separados por comas al nivel 0 de anidamiento.
 * Ignora comas dentro de generics <>, closures |...|, etc. */
function contarComasNivel0(texto: string): number {
  const limpio = texto.trim();
  if (limpio === '' || limpio === '&self' || limpio === '&mut self' || limpio === 'self') {
    return 0;
  }

  let nivel = 0;
  let comas = 0;

  for (const ch of limpio) {
    if (ch === '<' || ch === '(' || ch === '[') { nivel++; }
    if (ch === '>' || ch === ')' || ch === ']') { nivel--; }
    if (ch === ',' && nivel === 0) { comas++; }
  }

  /* N comas = N+1 parametros. Restar self/&self que no cuenta como parametro de negocio */
  let numParams = comas + 1;
  if (/^\s*&?\s*(?:mut\s+)?self/.test(limpio)) {
    numParams--;
  }

  return numParams;
}

/* Mide la longitud efectiva de una funcion (excluyendo lineas vacias y comentarios).
 * Desde la linea fn hasta la } de cierre al mismo nivel de indentacion. */
function medirLongitudFuncion(lineas: string[], inicio: number): number {
  let profundidad = 0;
  let encontroCuerpo = false;
  let lineasEfectivas = 0;
  let enComentarioBloque = false;

  for (let i = inicio; i < lineas.length; i++) {
    const linea = lineas[i];
    const trimmed = linea.trim();

    /* Conteo de llaves */
    for (const ch of linea) {
      if (ch === '{') {
        if (!encontroCuerpo) { encontroCuerpo = true; }
        profundidad++;
      }
      if (ch === '}') {
        profundidad--;
        if (profundidad === 0 && encontroCuerpo) {
          return lineasEfectivas;
        }
      }
    }

    /* No contar la firma como parte del cuerpo */
    if (!encontroCuerpo) { continue; }

    /* Excluir comentarios de bloque */
    if (!enComentarioBloque && trimmed.startsWith('/*')) {
      enComentarioBloque = true;
      if (trimmed.includes('*/') && !trimmed.endsWith('/*')) {
        enComentarioBloque = false;
      }
      continue;
    }
    if (enComentarioBloque) {
      if (trimmed.includes('*/')) { enComentarioBloque = false; }
      continue;
    }

    /* Excluir lineas vacias y comentarios de linea */
    if (trimmed === '' || trimmed.startsWith('//')) { continue; }

    lineasEfectivas++;
  }

  return lineasEfectivas;
}
