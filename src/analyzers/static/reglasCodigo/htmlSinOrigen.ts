/*
 * Regla html-sin-origen-declarado: productor de HTML exportado fuera de la
 * allowlist del proyecto. Extraida de staticCodeRules.ts.
 */

import { Violacion } from '../../../types';
import { CoreTextDocument } from '../../../core/runtime-proyecto/types';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';

/* [149A-1] html-sin-origen-declarado (error, solo .ts/.tsx no .d.ts).
 * Flaggea al PRODUCTOR: funcion exportada cuyo cuerpo contiene un literal
 * con etiqueta HTML (caso real mensajesUtil.ts:102-104). NO flaggea al
 * consumidor con allowlist (dangerouslySetInnerHTML/innerHTML): ese ya es
 * codigo declarado.
 * La allowlist es configurable por proyecto (patron directoryExceptions):
 * `htmlProductoresPermitidos` con sufijos de ruta; el default es VACIO y
 * cada consumidor declara los suyos (los 3 auditados son semilla, no verdad:
 * al no poder verificarse aqui, no se hardcodean). Match por sufijo para
 * que valga en cualquier checkout. Waiver file-level: sentinel-disable-file.
 * Limite: heuristica sintactica (export + literal HTML); un productor
 * construido por concatenacion sin literal con '<tag' no se ve.
 * Precision H11 (self-scan 2026-09-14: 17 FP): solo cuentan los template
 * literals con backtick (el productor real interpola: `<div>${x}</div>`).
 * Las cadenas con comillas son mensajes/usage/diagnostico ('<id>', '<json>',
 * 'Mutex<Connection>', 'Usar <button>...') y las lineas de comentario
 * (//, /*, *) se saltan. Segunda red: el tag debe ser HTML conocido (mata
 * placeholders <token>, <dir> y genericos en backticks). Tradeoff
 * documentado: un productor con HTML de una linea en comillas simples no
 * se ve; el caso real auditado (mensajesUtil) usa backtick con
 * interpolacion. Riesgo residual aceptado: un mensaje en backtick que
 * cite un tag en minusculas (`Usar <button>...`) flaggearia; en el
 * self-scan no existe ese patron (los mensajes usan comillas o citan
 * <Button> componente). */
const PATRON_EXPORT_TS = /export\s+(?:async\s+)?(?:function|const)\s+\w+/;
/* Solo backticks (ver tradeoff arriba): el productor interpola. Los generics
 * (Array<string>) quedan fuera por construccion: no son backtick. */
const PATRON_TEMPLATE_TS = /`(?:[^`\\]|\\.)*`/g;
/* Tags HTML reales (no placeholders <id>/<dir>/<json>/<token> ni genericos
 * tipo Mutex<Connection>). Lista cerrada a proposito: un tag inventado en
 * un template es sospechoso por otra via, no por esta regla. */
const TAGS_HTML_CONOCIDOS = new Set([
  'a', 'abbr', 'article', 'aside', 'audio', 'b', 'blockquote', 'body', 'br',
  'button', 'canvas', 'caption', 'code', 'col', 'div', 'em', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'head', 'header', 'hr', 'html', 'i', 'iframe', 'img', 'input',
  'label', 'legend', 'li', 'link', 'main', 'meta', 'nav', 'ol', 'option',
  'p', 'pre', 'script', 'section', 'select', 'small', 'span', 'strong',
  'style', 'table', 'tbody', 'td', 'template', 'textarea', 'th', 'thead',
  'title', 'tr', 'u', 'ul', 'video',
]);
const PATRON_TAG_CANDIDATO = /<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?\/?>/g;

function templateConHtml(template: string): boolean {
  PATRON_TAG_CANDIDATO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATRON_TAG_CANDIDATO.exec(template)) !== null) {
    /* Case-sensitive a proposito: <Button> es un componente, no un tag
     * HTML (<button> minusculas si). Self-scan: mataba los 2 ultimos FP
     * (mensajes que citan <Button>). Un <DIV> en mayusculas no se veria:
     * en productores reales los tags van en minusculas. */
    if (TAGS_HTML_CONOCIDOS.has(m[1])) { return true; }
  }
  return false;
}

function lineaConHtmlLiteral(linea: string): boolean {
  PATRON_TEMPLATE_TS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATRON_TEMPLATE_TS.exec(linea)) !== null) {
    if (templateConHtml(m[0])) { return true; }
  }
  return false;
}

export function verificarHtmlSinOrigenDeclarado(
  texto: string,
  documento: CoreTextDocument,
  productoresPermitidos: string[] = [],
): Violacion[] {
  if (tieneSentinelDisableFile(texto, 'html-sin-origen-declarado')) { return []; }
  if (!PATRON_EXPORT_TS.test(texto)) { return []; }

  const lineas = texto.split('\n');
  let lineaProductora = -1;
  for (let i = 0; i < lineas.length; i++) {
    const trimmed = lineas[i].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) { continue; }
    if (lineaConHtmlLiteral(lineas[i])) { lineaProductora = i; break; }
  }
  if (lineaProductora === -1) { return []; }

  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  for (const permitido of productoresPermitidos) {
    if (permitido !== '' && rutaNorm.endsWith(permitido)) { return []; }
  }

  return [{
    reglaId: 'html-sin-origen-declarado',
    mensaje: 'Funcion exportada que construye HTML sin estar declarada en la allowlist del proyecto (htmlProductoresPermitidos). Declarar el productor o revisar que el HTML se genera sin interpolar input externo.',
    severidad: obtenerSeveridadRegla('html-sin-origen-declarado'),
    linea: lineaProductora,
    fuente: 'estatico',
  }];
}
