import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { esArchivoSoloTest } from '../rustTestScope';
import { REGLA_PATH_JOIN, tieneDisableSiguiente, rangosFunciones } from './rustReglasCompartidas';

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

/* [16A-9] Valor fijo atado en el scope: `let x = "lit";` o
 * `for x in ["a", "b"] {`. El identificador solo puede tomar un literal de
 * compilacion, asi que no hay traversal posible: exento. Caso real
 * `rescatar.rs:407` (`for key_name in ["id_ed25519", ...] { ssh_dir.join(key_name) }`).
 * [por que] la exencion exige visibilidad real (profundidad de llaves) y que
 * nada reate ni reasigne el id antes del join: si no, el parametro homonimo de
 * un bloque hermano quedaria exento por error (falso negativo). */
const PATRON_ARG_IDENT = /^\s*&?\s*([a-z_][A-Za-z0-9_]*)\s*$/;
const PATRON_LET_LITERAL =
  /^\s*let\s+(?:mut\s+)?([a-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*"(?:[^"\\]|\\.)*"\s*;\s*$/;
const PATRON_FOR_LISTA = /^\s*for\s+([a-z_][A-Za-z0-9_]*)\s+in\s*\[([^\]]*)\]\s*\{/;
const PATRON_LISTA_LITERALES = /^\s*("(?:[^"\\]|\\.)*"\s*,\s*)*"(?:[^"\\]|\\.)*"\s*,?\s*$/;

/* Quita literales de cadena y de caracter: las llaves de `format!("{x}")` no
 * deben contar como bloque al medir profundidad. */
function sinLiterales(linea: string): string {
  return linea.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)'/g, "''");
}

/* Profundidad de llaves al COMENZAR cada linea del scope (relativa a inicio). */
function profundidades(lineas: string[], inicio: number, fin: number): number[] {
  const prof: number[] = [];
  let d = 0;
  for (let j = inicio; j <= fin; j++) {
    prof[j] = d;
    for (const ch of sinLiterales(lineas[j])) {
      if (ch === '{') { d++; } else if (ch === '}') { d--; }
    }
  }
  return prof;
}

/* Profundidad de llaves en la columna `col` de la linea `j`. */
function profundidadEn(lineas: string[], prof: number[], j: number, col: number): number {
  let d = prof[j];
  for (const ch of sinLiterales(lineas[j]).slice(0, col)) {
    if (ch === '{') { d++; } else if (ch === '}') { d--; }
  }
  return d;
}

/* `id` es valor fijo en la linea `i`? */
function atadoAFijo(
  lineas: string[],
  prof: number[],
  inicio: number,
  i: number,
  id: string,
): boolean {
  let atado = -1;
  let profAtado = 0;
  for (let j = inicio; j < i; j++) {
    const mL = PATRON_LET_LITERAL.exec(lineas[j]);
    if (mL && mL[1] === id) {
      atado = j;
      profAtado = profundidadEn(lineas, prof, j, mL.index);
      continue;
    }
    const mF = PATRON_FOR_LISTA.exec(lineas[j]);
    if (mF && mF[1] === id && PATRON_LISTA_LITERALES.test(mF[2])) {
      atado = j;
      profAtado = profundidadEn(lineas, prof, j, mF.index);
    }
  }
  if (atado < 0) { return false; }
  /* Visible desde el join: no mas profundo, y su bloque no se cerro antes. */
  if (profAtado > prof[i]) { return false; }
  for (let k = atado + 1; k < i; k++) {
    if (prof[k] < profAtado) { return false; }
  }
  /* Reatado (`let`/`for` que lo vuelve a nombrar) o reasignado: deja de ser
   * fijo. Se exige que el id quede a la IZQUIERDA del `=`: usarlo en la parte
   * derecha (`let p = base.join(key_name)`) no lo reata. */
  const reata = new RegExp(`\\blet\\s+(?:mut\\s+)?[^=]*\\b${id}\\b\\s*(?::[^=]+)?=`);
  const reataFor = new RegExp(`\\bfor\\s+${id}\\b`);
  const asigna = new RegExp(`(^|[^\\w.])${id}\\s*(?:[-+*/])?=(?!=)`);
  for (let k = inicio; k < i; k++) {
    if (k === atado) { continue; }
    if (!new RegExp(`\\b${id}\\b`).test(lineas[k])) { continue; }
    if (reata.test(lineas[k]) || reataFor.test(lineas[k]) || asigna.test(lineas[k])) { return false; }
  }
  return true;
}

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
  if (tieneSentinelDisableFile(texto, REGLA_PATH_JOIN)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }
  /* [08AA-26] PATRON_JOIN es global (/g para el bucle exec con reset en
   * cada linea): resetear tambien antes de este pre-chequeo. Sin reset,
   * un scope eximido (canonicalize/guardia lexica) deja lastIndex
   * avanzado y el siguiente fichero analizado en el mismo proceso puede
   * dar falso negativo segun longitudes (FP/FN por orden de analisis). */
  PATRON_JOIN.lastIndex = 0;
  if (!PATRON_JOIN.test(texto)) { return []; }

  const violaciones: Violacion[] = [];

  for (const [inicio, fin] of rangosFunciones(lineas, rangoTests)) {
    let tieneCanonicalize = false;
    /* [08AA-26] Guardia lexica: el scope filtra los componentes a
     * `Component::Normal` antes del join (p.ej. `rel.components().all(|c|
     * matches!(c, Component::Normal(_)))`): `..`, vacios y absolutos no
     * llegan al join. Para este patron equivale a canonicalize +
     * starts_with. Caso MN `turno.rs::ruta_clave` 2026-10-08. */
    let tieneGuardiaLexica = false;
    for (let j = inicio; j <= fin; j++) {
      if (lineas[j].includes('canonicalize')) { tieneCanonicalize = true; break; }
      if (/Component::\s*Normal/.test(lineas[j])) { tieneGuardiaLexica = true; }
    }
    if (tieneCanonicalize || tieneGuardiaLexica) { continue; }

    /* [16A-9] Profundidad de llaves del scope: la exencion por valor fijo
     * necesita saber si el binding sigue visible en la linea del join. */
    const prof = profundidades(lineas, inicio, fin);

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
        } else if (PATRON_ARG_SOLO_LITERALES.test(args) || PATRON_ARG_SOLO_CONSTANTE.test(args)) {
          /* Literal o constante de modulo: segmento fijo. */
        } else {
          /* [16A-9] Identificador atado a un literal en el scope: tambien fijo. */
          const ident = PATRON_ARG_IDENT.exec(args);
          const fijo = ident !== null && atadoAFijo(lineas, prof, inicio, i, ident[1]);
          if (!fijo) {
            sospechoso = { index: match.index, len: match[0].length };
          }
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
