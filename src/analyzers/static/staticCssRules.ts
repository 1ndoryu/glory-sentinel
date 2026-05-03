/*
 * Reglas CSS para el analyzer estatico.
 * Detecta: nomenclatura en ingles (protocolo requiere espanol),
 * colores hardcodeados (desactivada por defecto).
 */

import * as vscode from 'vscode';
import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { tieneSentinelDisable } from '../../utils/analisisHelpers';

const CLASES_BOTON_SISTEMA = new Set([
  'menuContextualBoton',
  'boton', 'botonBase', 'botonPrimario', 'botonSecundario', 'botonOutline', 'botonTexto',
  'botonExito', 'botonExitoSuave', 'botonPeligro', 'botonPeligroSuave',
  'botonAdvertencia', 'botonAdvertenciaSuave', 'botonInfo', 'botonInfoSuave',
  'botonPequeno', 'botonMediano', 'botonGrande',
]);

const CLASES_MODAL_CANONICAS = new Set([
  'modalTitulo',
  'modalTexto',
  'modalAcciones',
]);

const REGLA_MODAL_SEMANTICA = 'modal-semantica-no-canonica';

function detectarSufijoSemanticoModal(nombreClase: string): 'Titulo' | 'Texto' | 'Descripcion' | 'Acciones' | null {
  if (CLASES_MODAL_CANONICAS.has(nombreClase)) {
    return null;
  }

  const match = /(?:^modal[A-Z][\w-]*|^[A-Za-z][\w-]*Modal)(Titulo|Texto|Descripcion|Acciones)$/.exec(nombreClase);
  return (match?.[1] as 'Titulo' | 'Texto' | 'Descripcion' | 'Acciones' | undefined) ?? null;
}

function claseCanonicaModal(sufijo: 'Titulo' | 'Texto' | 'Descripcion' | 'Acciones'): 'modalTitulo' | 'modalTexto' | 'modalAcciones' {
  if (sufijo === 'Titulo') {
    return 'modalTitulo';
  }

  if (sufijo === 'Acciones') {
    return 'modalAcciones';
  }

  return 'modalTexto';
}

function bloqueDefineSemanticaModal(cuerpo: string, sufijo: 'Titulo' | 'Texto' | 'Descripcion' | 'Acciones'): boolean {
  const cuerpoLimpio = cuerpo.replace(/\/\*[\s\S]*?\*\//g, ' ');

  if (sufijo === 'Acciones') {
    return /(display\s*:\s*flex|justify-content\s*:|align-items\s*:|gap\s*:)/i.test(cuerpoLimpio);
  }

  return /(font-size\s*:|font-family\s*:|font-weight\s*:|line-height\s*:|color\s*:|text-align\s*:|letter-spacing\s*:|margin(?:-top|-bottom)?\s*:)/i.test(cuerpoLimpio);
}

/*
 * Detecta clases CSS con nombres en ingles.
 * El protocolo requiere nombres en espanol (ej: .contenedor, .boton).
 * Excluye librerias, clases de estado (active, disabled, etc.) y sidebar.
 */
export function verificarNomenclaturaCssIngles(
  texto: string,
  documento: vscode.TextDocument,
  nombreArchivo: string,
): Violacion[] {
  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  if (rutaNorm.includes('node_modules') || rutaNorm.includes('vendor') ||
      rutaNorm.includes('shadcn') || rutaNorm.includes('tailwind')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  /* Diccionario de palabras inglesas comunes en selectores CSS.
   * (?!-) evita falsos positivos con prefijos. */
  const regexIngles = /\.(main|container|wrapper|button|header|footer|content|card|item|input|form|modal|dropdown|toggle|alert|tooltip|carousel|slider|pagination|breadcrumb|accordion|spinner|loader|overlay|backdrop|divider|grid|column|flex|stack|box|title|subtitle|heading|label|caption|description|link|icon|thumbnail|table|checkbox|radio|select|textarea|switch|progress|dialog|drawer|menu|toolbar|tag|chip|step|timeline|tree|upload|download|search|filter|sort|block|primary|secondary|dark|light|small|medium|large)\b(?!-)/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) { continue; }
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line nomenclatura-css-ingles')) { continue; }

    const match = regexIngles.exec(linea);
    if (match) {
      violaciones.push({
        reglaId: 'nomenclatura-css-ingles',
        mensaje: `Clase CSS en ingles ".${match[1]}". El protocolo requiere nombres en espanol (ej: .contenedor, .boton).`,
        severidad: obtenerSeveridadRegla('nomenclatura-css-ingles'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Detecta variantes *CardIcono que redefinen la receta base de .panelCardIcono.
 * La clase variante debe usarse solo para overrides puntuales y no recrear
 * display/alineacion/flex-shrink desde cero.
 */
export function verificarCardIconoExtiendeBase(
  texto: string,
  documento: vscode.TextDocument,
  nombreArchivo: string,
): Violacion[] {
  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  if (rutaNorm.includes('node_modules') || rutaNorm.includes('vendor')) {
    return [];
  }

  const nombreLower = nombreArchivo.toLowerCase();
  if (nombreLower === 'panelisland.css' || nombreLower === 'panelisland.scss') {
    return [];
  }

  if (texto.includes('sentinel-disable-file card-icono-debe-extender-base')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');
  const regexSelector = /^\.([A-Za-z][\w-]*CardIcono)\s*\{/;
  const regexPropiedadBase = /^(display\s*:\s*flex|align-items\s*:\s*center|justify-content\s*:\s*center|flex-shrink\s*:\s*0)\b/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) { continue; }

    const match = regexSelector.exec(linea);
    if (!match) { continue; }

    const nombreClase = match[1];
    if (nombreClase === 'panelCardIcono') { continue; }
    /* [25A-SENT-FP] Usa tieneSentinelDisable para soportar disable comments multi-linea */
    if (tieneSentinelDisable(lineas, i, 'card-icono-debe-extender-base')) { continue; }

    let redefineBase = false;
    for (let j = i + 1; j < lineas.length; j++) {
      const lineaBloque = lineas[j].trim();
      if (lineaBloque.startsWith('/*') || lineaBloque.startsWith('*') || lineaBloque.startsWith('//')) { continue; }
      if (lineaBloque.includes('}')) { break; }
      if (regexPropiedadBase.test(lineaBloque)) {
        redefineBase = true;
        break;
      }
    }

    if (!redefineBase) { continue; }

    violaciones.push({
      reglaId: 'card-icono-debe-extender-base',
      mensaje: `La clase CSS ".${nombreClase}" redefine la base compartida de card icon. Usa .panelCardIcono en JSX y deja aqui solo overrides puntuales.`,
      severidad: obtenerSeveridadRegla('card-icono-debe-extender-base'),
      linea: i,
      fuente: 'estatico',
    });
  }

  return violaciones;
}

/* [104A-11]
 * Detecta estilos CSS de botones ad-hoc fuera del sistema Button.
 * A diferencia de la regex plana, esta version:
 * - ignora comentarios con la palabra boton/button
 * - ignora selectores nativos tipo button.tarjetaBase
 * - ignora clases base del sistema (menuContextualBoton, botonBase, etc.)
 * - ignora assets legacy y glory-rs, donde el sistema define sus propios estilos
 */
export function verificarCssAdhocButtonStyle(
  texto: string,
  documento: vscode.TextDocument,
  nombreArchivo: string,
): Violacion[] {
  const nombreLower = nombreArchivo.toLowerCase();
  const rutaNorm = documento.fileName.replace(/\\/g, '/');

  if (nombreLower === 'button.css' || nombreLower === 'variables.css') {
    return [];
  }

  if (rutaNorm.includes('/node_modules/') || rutaNorm.includes('/vendor/') ||
      rutaNorm.includes('/glory-rs/') || rutaNorm.includes('/public/assets/')) {
    return [];
  }

  if (texto.includes('sentinel-disable-file css-adhoc-button-style')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const regexBloques = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regexBloques.exec(texto)) !== null) {
    const selectorRaw = match[1];
    const cuerpo = match[2];
    const selector = selectorRaw.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();

    if (!selector || selector.startsWith('@')) {
      continue;
    }

    if (!/cursor\s*:\s*pointer/i.test(cuerpo)) {
      continue;
    }

    const clasesSelector = Array.from(selector.matchAll(/[.#]([A-Za-z_][\w-]*)/g)).map(grupo => grupo[1]);
    if (clasesSelector.length === 0) {
      continue;
    }

    const claseProblematica = clasesSelector.find(nombreClase => {
      if (!/(?:boton|button)/i.test(nombreClase)) {
        return false;
      }

      return !CLASES_BOTON_SISTEMA.has(nombreClase);
    });

    if (!claseProblematica) {
      continue;
    }

    const linea = texto.slice(0, match.index).split('\n').length - 1;
    violaciones.push({
      reglaId: 'css-adhoc-button-style',
      mensaje: 'Bloque CSS de boton detectado fuera de Button.css. Si es un boton, usar <Button variante="..."> en su lugar.',
      severidad: obtenerSeveridadRegla('css-adhoc-button-style'),
      linea,
      fuente: 'estatico',
    });
  }

  return violaciones;
}

/*
 * Detecta clases de modal por componente que duplican semantica compartida.
 * Casos como .ordenDetalleModalTexto o .modalCompraDescripcion deben reutilizar
 * .modalTexto/.modalTitulo/.modalAcciones y dejar solo layout o estado local.
 */
export function verificarModalSemanticaNoCanonica(
  texto: string,
  documento: vscode.TextDocument,
  nombreArchivo: string,
): Violacion[] {
  const nombreLower = nombreArchivo.toLowerCase();
  const rutaNorm = documento.fileName.replace(/\\/g, '/');

  if (/^variables\.css$/.test(nombreLower)) {
    return [];
  }

  if (rutaNorm.includes('/node_modules/') || rutaNorm.includes('/vendor/') ||
      rutaNorm.includes('/glory-rs/') || rutaNorm.includes('/public/assets/')) {
    return [];
  }

  if (texto.includes(`sentinel-disable-file ${REGLA_MODAL_SEMANTICA}`)) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');
  const regexBloques = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regexBloques.exec(texto)) !== null) {
    const selectorRaw = match[1];
    const selector = selectorRaw.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    const cuerpo = match[2];
    const lineaBase = texto.slice(0, match.index).split('\n').length - 1;
    const linea = lineaBase + (selectorRaw.split('\n').length - 1);

    if (!selector || selector.startsWith('@')) {
      continue;
    }

    if (tieneSentinelDisable(lineas, linea, REGLA_MODAL_SEMANTICA)) {
      continue;
    }

    const clasesSelector = Array.from(selector.matchAll(/\.([A-Za-z_][\w-]*)/g)).map(grupo => grupo[1]);
    const claseProblematica = clasesSelector.find(nombreClase => {
      const sufijo = detectarSufijoSemanticoModal(nombreClase);
      return sufijo ? bloqueDefineSemanticaModal(cuerpo, sufijo) : false;
    });

    if (!claseProblematica) {
      continue;
    }

    const sufijo = detectarSufijoSemanticoModal(claseProblematica);
    if (!sufijo) {
      continue;
    }

    const claseCanonica = claseCanonicaModal(sufijo);
    violaciones.push({
      reglaId: REGLA_MODAL_SEMANTICA,
      mensaje: `La clase "${claseProblematica}" duplica semantica visual compartida de Modal. Usa className="${claseCanonica}" y deja el layout/estado en clases locales separadas.`,
      severidad: obtenerSeveridadRegla(REGLA_MODAL_SEMANTICA),
      linea,
      fuente: 'estatico',
    });
  }

  return violaciones;
}

/*
 * Detecta colores y valores hardcodeados en CSS que deberian usar variables.
 * Desactivada por decision de producto (falsos positivos con valores literales validos).
 */
export function verificarCssHardcoded(
  texto: string,
  documento: vscode.TextDocument,
  nombreArchivo: string,
): Violacion[] {
  const nombreLower = nombreArchivo.toLowerCase();
  if (/variables\.css|init\.css|theme\.css|tokens\.css/.test(nombreLower)) {
    return [];
  }

  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  if (rutaNorm.includes('node_modules') || rutaNorm.includes('vendor')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');
  let dentroRoot = false;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) { continue; }
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line css-hardcoded-value')) { continue; }

    /* Rastrear bloque :root */
    if (/:root\s*\{/.test(linea)) { dentroRoot = true; }
    if (dentroRoot && /\}/.test(linea)) { dentroRoot = false; }
    if (dentroRoot) { continue; }

    /* Saltar definiciones de variables CSS y lineas con var() */
    if (/^\s*--/.test(lineas[i])) { continue; }
    if (/var\s*\(/.test(linea)) { continue; }

    /* Detectar colores hex */
    if (/#[0-9a-fA-F]{3,8}\b/.test(linea)) {
      const antesHash = linea.indexOf('#');
      const antesComentario = linea.indexOf('//');
      if (antesComentario >= 0 && antesComentario < antesHash) { continue; }

      violaciones.push({
        reglaId: 'css-hardcoded-value',
        mensaje: 'Color hex hardcodeado. Usar variable CSS: var(--color-nombre).',
        severidad: obtenerSeveridadRegla('css-hardcoded-value'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    /* Detectar rgb/rgba/hsl/hsla */
    if (/\b(rgba?|hsla?)\s*\(/.test(linea)) {
      violaciones.push({
        reglaId: 'css-hardcoded-value',
        mensaje: 'Color rgb/hsl hardcodeado. Usar variable CSS: var(--color-nombre).',
        severidad: obtenerSeveridadRegla('css-hardcoded-value'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Detecta selectores CSS que apuntan directamente a elementos HTML nativos
 * (button, h1-h6) dentro de una clase de componente.
 *
 * Patron problemático: .{componenteEspecifico} button { ... }
 *                      .{componenteEspecifico} h3 { ... }
 *
 * El correcto es dar className al componente React:
 *   - Para botones: usar className="..." en <Button>, no selector raw.
 *   - Para titulos en modales/panel: usar className="modalTitulo" en JSX.
 *
 * Excepciones válidas (no se reportan):
 *   - .tiptap h* (contenido renderizado del editor rico)
 *   - .{algo}Texto h* (contenido HTML de artículos, blog)
 *   - .{algo}Vacio h* (estados vacíos con h neutral)
 *   - init.css, Button.css, Modal.css, variables.css (base del sistema)
 */
export function verificarCssElementoHTMLDirecto(
  texto: string,
  documento: vscode.TextDocument,
  nombreArchivo: string,
): Violacion[] {
  const nombreLower = nombreArchivo.toLowerCase();
  if (/^(button|init|variables|modal|reset)\.css$/.test(nombreLower)) {
    return [];
  }

  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  if (rutaNorm.includes('/node_modules/') || rutaNorm.includes('/vendor/') ||
      rutaNorm.includes('/glory-rs/') || rutaNorm.includes('/public/assets/')) {
    return [];
  }

  if (texto.includes('sentinel-disable-file css-elemento-html-directo')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  /* Selector: .{class} button { o .{class} h1-h6 { */
  const regexElementoHTML = /^\s*\.[\w-]+\s+(button|h[1-6])\s*[{,]/;

  /* Excepciones: contextos donde estilar h* directamente es válido */
  const excepcionH = /\.(tiptap|[a-zA-Z]+Texto|[a-zA-Z]+Vacio|[a-zA-Z]+Single)\s+h[1-6]/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) { continue; }
    if (tieneSentinelDisable(lineas, i, 'css-elemento-html-directo')) { continue; }

    const match = regexElementoHTML.exec(linea);
    if (!match) { continue; }

    const elemento = match[1];
    if (elemento !== 'button' && excepcionH.test(linea)) { continue; }

    const mensaje = elemento === 'button'
      ? `Selector ".{clase} button" detectado. Pasar className al <Button> en lugar de apuntar al elemento raw.`
      : `Selector ".{clase} ${elemento}" detectado. Usar className="modalTitulo" en JSX en lugar de estilar por selector de elemento.`;

    violaciones.push({
      reglaId: 'css-elemento-html-directo',
      mensaje,
      severidad: obtenerSeveridadRegla('css-elemento-html-directo'),
      linea: i,
      fuente: 'estatico',
    });
  }

  return violaciones;
}
