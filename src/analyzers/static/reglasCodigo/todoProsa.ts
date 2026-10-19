/*
 * Regla todo-prosa-sin-marcador: mencion de "todo" en comentarios sin marcador
 * de tarea. Extraida de staticCodeRules.ts.
 */

import { Violacion } from '../../../types';
import { CoreTextDocument, positionAtOffset } from '../../../core/runtime-proyecto/types';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { PATRON_TODO_PROSA, ARTICULOS_PROSA, PALABRAS_CUANTIFICADOR, esInfinitivo, PREPOSICIONES_PROSA } from './todoProsaLexico';
import { extraerRegionesComentarioTodoProsa } from './todoProsaRegiones';

/*
 * [289A-1] Mencion de tarea sin marcador en comentarios: exige marcador de
 * tarea (TODO:/TODO(/TODO[/FIXME/XXX). Migrada desde VarSense
 * (TodoProsaSinMarcador [149A-1 F3.13]): es higiene de codigo, dueno Sentinel.
 * Complementa a todo-pendiente (que marca los marcadores explicitos): esta
 * marca la mencion informal que intenta ser tarea sin usar marcador.
 * Solo inspecciona regiones de comentario real (// y /* ... *\/): enmascara
 * literales '...' "..." `...` para no marcar prosa dentro de strings.
 * Guardas 0 FP (paridad VarSense):
 *   - formas con `:`/`(`/`[` → marcador valido, no marca;
 *   - prosa con articulo (el|la|los|las|lo) → no marca;
 *   - cuantificador en ultima posicion del comentario → en minusculas es
 *     prosa española, no marca; la forma mayuscula sola si marca
 *     porque se exige la forma con dos puntos;
 *   - compuestos con guion (tipo todo-list) → no marca;
 *   - `/todo` (URL/ruta dentro del comentario) → no marca;
 *   - cuantificador a mitad de frase ("…, todo centrado)") → no marca: el
 *     marcador informal abre el comentario o su linea ("// todo revisar esto",
 *     "* todo revisar"); dentro de la oracion, "todo" es el cuantificador.
 *     La forma en mayusculas si marca en cualquier posicion.
 *   - FIXME/XXX nunca marcan (son marcadores validos por si mismos).
 * Nota de paridad: HACK no exime por si solo (igual que en VarSense); solo
 * exime si la mencion lleva marcador (`TODO:` etc.).
 * Honra sentinel-disable-file, sentinel-disable-next-line e inline.
 */
/* Abre el comentario o su linea: solo blancos y los adornos de comentario
 * (`*` de bloque, `/` de linea) entre el inicio de la linea y la mencion.
 * [Falso positivo real, 16A-4] "Variantes: … (icono destacado encima del
 * titulo, todo centrado)." marcaba: el cuantificador español vive dentro de la
 * oracion, mientras que el marcador informal abre la linea. Solo la forma en
 * mayusculas marca en cualquier posicion, porque es la taquigrafia explicita. */
function abreLineaDeComentario(textoComentario: string, indice: number): boolean {
  const salto = textoComentario.lastIndexOf('\n', indice - 1);
  return /^[\s*/]*$/.test(textoComentario.slice(salto + 1, indice));
}

function esTodoProsaSinMarcador(textoComentario: string, indice: number, forma: string): boolean {
  const anterior = indice > 0 ? textoComentario[indice - 1] : '';
  /* URL/ruta dentro del comentario (https://…/todo) o parte de un
   * identificador kebab-case (evento regenerar-todo): no es prosa. */
  if (anterior === '/' || anterior === '-') {
    return false;
  }
  /* Cuantificador a mitad de frase. */
  if (forma !== 'TODO' && !abreLineaDeComentario(textoComentario, indice)) {
    return false;
  }

  let j = indice + forma.length;
  while (j < textoComentario.length && /\s/.test(textoComentario[j])) {
    j++;
  }
  const siguiente = j < textoComentario.length ? textoComentario[j] : '';
  /* Marcador valido TODO:/TODO(/TODO[. */
  if (siguiente === ':' || siguiente === '(' || siguiente === '[') {
    return false;
  }
  /* Compuesto tipo todo-list: sustantivo, no tarea. */
  if (siguiente === '-') {
    return false;
  }

  /* Prosa española "todo el|la|los|las|lo …": no es una tarea. */
  let k = j;
  let palabra = '';
  while (k < textoComentario.length && /[A-Za-z]/.test(textoComentario[k])) {
    palabra += textoComentario[k];
    k++;
  }
  if (ARTICULOS_PROSA.has(palabra.toLowerCase())) {
    return false;
  }
  if (forma !== 'TODO' && PALABRAS_CUANTIFICADOR.has(palabra.toLowerCase())) {
    return false;
  }
  if (forma !== 'TODO') {
    let nucleo = palabra.toLowerCase();
    if (PREPOSICIONES_PROSA.has(nucleo)) {
      let m = k;
      while (m < textoComentario.length && /\s/.test(textoComentario[m])) { m++; }
      let tras = '';
      while (m < textoComentario.length && /[A-Za-z]/.test(textoComentario[m])) {
        tras += textoComentario[m];
        m++;
      }
      nucleo = tras.toLowerCase();
    }
    if (!esInfinitivo(nucleo)) {
      return false;
    }
  }

  /* Ultima palabra del comentario ("re-parsear todo.", "todo, …"): en
   * minusculas es el cuantificador español (equivale a "everything"), no
   * una tarea; en mayusculas es la taquigrafia de tarea y marca porque
   * se exige el marcador con dos puntos. */
  const resto = textoComentario.slice(k);
  if (/^[\s.,;!?…)\]}]*$/.test(resto)) {
    return forma === 'TODO';
  }

  return true;
}

export function verificarTodoProsaSinMarcador(
  texto: string,
  documento: CoreTextDocument,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, 'todo-prosa-sin-marcador')) { return []; }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  for (const region of extraerRegionesComentarioTodoProsa(texto)) {
    const comentario = texto.slice(region.inicio, region.fin);
    PATRON_TODO_PROSA.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = PATRON_TODO_PROSA.exec(comentario)) !== null) {
      if (!esTodoProsaSinMarcador(comentario, match.index, match[0])) {
        continue;
      }
      const offset = region.inicio + match.index;
      const pos = positionAtOffset(documento, offset);
      const lineaTexto = lineas[pos.line] ?? '';
      if (lineaTexto.includes('sentinel-disable todo-prosa-sin-marcador')) { continue; }
      if (pos.line > 0 && (lineas[pos.line - 1] ?? '').includes('sentinel-disable-next-line todo-prosa-sin-marcador')) { continue; }

      violaciones.push({
        reglaId: 'todo-prosa-sin-marcador',
        mensaje: `Mencion a 'todo' sin marcador de tarea - usa TODO:, TODO(...), FIXME o XXX`,
        severidad: obtenerSeveridadRegla('todo-prosa-sin-marcador'),
        linea: pos.line,
        columna: pos.character,
        sugerencia: 'Marca la tarea pendiente con TODO:, FIXME o XXX, o redacta el comentario sin la palabra "todo".',
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
