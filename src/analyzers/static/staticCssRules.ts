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
