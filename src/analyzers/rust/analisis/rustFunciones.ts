/* Reglas Rust (funciones largas y con demasiados parámetros (heurística por llaves y paréntesis).) Extraído de rustAnalyzer.ts. */
import { Violacion } from '../../../types';
import { reglaHabilitada, obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';

/* Limite de lineas efectivas por funcion (clippy tambien lo verifica,
 * pero Sentinel lo muestra inline sin necesidad de compilar) */
const LIMITE_LINEAS_FUNCION = 100;

/* Maximo parametros antes de sugerir agrupar en struct.
 * Ajustado a 8: en Rust, pool: &PgPool siempre es el primer parametro
 * (infraestructura, no diseño) y repos/services tienen multiples campos
 * tipados por operacion. Umbral 5 generaba falsos positivos masivos. */
const LIMITE_PARAMETROS = 8;

/* Analiza funciones: longitud y conteo de parametros.
 * Heuristica: busca `fn nombre(` y cuenta llaves hasta cerrar la funcion. */
export function analizarFunciones(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  const violaciones: Violacion[] = [];
  const disableFnLarga = tieneSentinelDisableFile(texto, 'funcion-larga-rs');
  const disableParams = tieneSentinelDisableFile(texto, 'parametros-excesivos-rs');

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
