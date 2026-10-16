/*
 * Reglas CSS para el analyzer estatico.
 * Detecta: nomenclatura en ingles (protocolo requiere espanol),
 * colores hardcodeados (desactivada por defecto).
 */

import { Violacion } from '../../types';
import { CoreTextDocument } from '../../core/types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import {
  indiceProyecto,
  tieneSentinelDisable,
} from '../../utils/analisisHelpers';

/* [15A-25] Movido a staticCssModalRules.ts por budget ADR 0001; se re-exporta
 * para no tocar importadores (staticAnalyzer, tests). */
export { verificarModalSemanticaNoCanonica } from './staticCssModalRules';

const CLASES_BOTON_SISTEMA = new Set([
  'menuContextualBoton',
  'boton', 'botonBase', 'botonPrimario', 'botonSecundario', 'botonOutline', 'botonTexto',
  'botonExito', 'botonExitoSuave', 'botonPeligro', 'botonPeligroSuave',
  'botonAdvertencia', 'botonAdvertenciaSuave', 'botonInfo', 'botonInfoSuave',
  'botonPequeno', 'botonMediano', 'botonGrande',
  /* [317A-3] Variantes kebab reales del proyecto (wandori.us usa kebab, no camelCase)
   * y la receta nueva .boton-icono (boton de solo icono para toolbars de apps). */
  'boton-pequeno', 'boton-mediano', 'boton-grande', 'boton-icono',
  'botonIcono',
]);


const REGLA_ESPECIFICACION_DISENO_LOCAL = 'css-especificacion-diseno-local';

const ARCHIVOS_RECETA_DISENO = new Set([
  'button.css',
  'contextmenu.css',
  'modal.css',
  'reset.css',
  'init.css',
  'variables.css',
]);

const CLASES_INTERACTIVAS_BASE = new Set([
  ...CLASES_BOTON_SISTEMA,
  'menuContextual',
  'menuContextualBoton',
  'menuContextualPanel',
  'menuContextualContenido',
  'menuContextualItem',
  'menuContextualItemDanger',
]);

const PATRONES_ROL_INTERACTIVO_LOCAL = [
  /(?:Trigger|Opcion|Option|Dropdown|Desplegable|SubMenu|Submenu|Menu|Panel|Lista|Item)$/,
  /__(?:trigger|dropdown|panel|item)$/i,
];

const PROPIEDADES_DISENO_CSS = [
  { nombre: 'background', patron: /\bbackground(?:-color|-image)?\s*:/i },
  { nombre: 'border', patron: /\bborder(?:-(?:top|right|bottom|left|color|style|width))?\s*:/i },
  { nombre: 'border-radius', patron: /\bborder-radius\s*:/i },
  { nombre: 'box-shadow', patron: /\bbox-shadow\s*:/i },
  { nombre: 'color', patron: /(?:^|[;\s])color\s*:/i },
  { nombre: 'font-size', patron: /\bfont-size\s*:/i },
  { nombre: 'font-family', patron: /\bfont-family\s*:/i },
  { nombre: 'font-weight', patron: /\bfont-weight\s*:/i },
  { nombre: 'line-height', patron: /\bline-height\s*:/i },
  { nombre: 'letter-spacing', patron: /\bletter-spacing\s*:/i },
  { nombre: 'padding', patron: /\bpadding(?:-(?:top|right|bottom|left))?\s*:/i },
  { nombre: 'text-align', patron: /\btext-align\s*:/i },
  { nombre: 'text-decoration', patron: /\btext-decoration\s*:/i },
  { nombre: 'transition', patron: /\btransition\s*:/i },
  { nombre: 'animation', patron: /\banimation\s*:/i },
  { nombre: 'opacity', patron: /\bopacity\s*:/i },
];

/* [15A-25] `detectarSufijoSemanticoModal`, `claseCanonicaModal` y
 * `bloqueDefineSemanticaModal` viven ahora en utils/analisisHelpers, porque la
 * regla de JSX `modal-acciones-no-canonico` necesita el mismo veredicto sobre el
 * mismo bloque CSS: una clase `*Acciones` no es la zona de botones por llamarse
 * asi, y la unica prueba esta en su hoja. */
function claseTieneRolInteractivoLocal(nombreClase: string): boolean {
  if (CLASES_INTERACTIVAS_BASE.has(nombreClase)) {
    return false;
  }

  return PATRONES_ROL_INTERACTIVO_LOCAL.some(patron => patron.test(nombreClase));
}

/* [15A-25] Familias cuyo nombre ya implica una superficie flotante o un
 * disparador: la receta la posee el sistema (contextmenu.css, dropdownPanel.css)
 * aunque el bloque no declare ningun gesto, porque el gesto esta en la superficie
 * — que se abre, se cierra y se posiciona. Una fila de lista, en cambio, no es un
 * control por llamarse `...Item`: eso hay que verlo. */
const PATRONES_ROL_SUPERFICIE = /(?:Trigger|Dropdown|Desplegable|SubMenu|Submenu|Menu|Panel)$/;

/* [15A-25] Si el selector ya lleva una clase del sistema interactivo
 * (`.botonBase.eliminarItem`), el bloque es un MODIFICADOR de esa receta, no una
 * reimplementacion: la clase base ya aporta el aspecto y aqui solo se ajusta. */
function selectorLlevaRecetaInteractiva(clasesSelector: string[]): boolean {
  return clasesSelector.some(clase => CLASES_INTERACTIVAS_BASE.has(clase));
}

function bloqueDeclaraGesto(cuerpo: string, selector: string): boolean {
  return /cursor\s*:|(?:transition|animation)\s*:|position\s*:\s*(?:absolute|fixed)/i.test(cuerpo)
    || /:(?:hover|focus|focus-visible|active)\b/.test(selector);
}

/* [15A-25] El sujeto de un selector es el ultimo compuesto de cada parte separada
 * por comas: en `.tarjetaColeccionLista .tarjetaColeccionPortada img` el bloque
 * estiliza `img`, no `.tarjetaColeccionLista`. La regla tomaba la PRIMERA clase con
 * rol de todo el selector y culpaba al ancestro. */
function clasesSujeto(selector: string): string[] {
  const clases: string[] = [];

  for (const parte of selector.split(',')) {
    const ultimoCompuesto = parte.trim().split(/[\s>+~]+/).pop() ?? '';
    for (const grupo of ultimoCompuesto.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      clases.push(grupo[1]);
    }
  }

  return clases;
}

/* [15A-25] La hoja que define la clase ES su receta: `.dropdownPanel` dentro de
 * dropdownPanel.css no es una especificacion local, es el canonico. */
function archivoEsRecetaDeClase(nombreLower: string, clase: string): boolean {
  return nombreLower === `${clase.toLowerCase()}.css`;
}

function obtenerPropiedadesDiseno(cuerpo: string): string[] {
  const cuerpoLimpio = cuerpo.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const propiedades = PROPIEDADES_DISENO_CSS
    .filter(propiedad => propiedad.patron.test(cuerpoLimpio))
    .map(propiedad => propiedad.nombre);

  /* [229A-1] `border-radius: 50%/100%` es geometria estructural (circulo),
   * no especificacion de diseno: un panel orbital decorativo
   * (radial-gradient + 50%) no debe contar como receta visual local.
   * Solo se descuenta cuando TODAS las declaraciones de border-radius del
   * bloque son circulo; `8px` o `var(--radius-sm)` siguen contando. */
  const indiceRadio = propiedades.indexOf('border-radius');
  if (indiceRadio !== -1 && todoRadioEsCirculo(cuerpoLimpio)) {
    propiedades.splice(indiceRadio, 1);
  }

  return propiedades;
}

function todoRadioEsCirculo(cuerpoLimpio: string): boolean {
  const valores: string[] = [];
  const regexRadio = /border-radius\s*:\s*([^;}{]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regexRadio.exec(cuerpoLimpio)) !== null) {
    valores.push(match[1].trim());
  }
  if (valores.length === 0) { return false; }
  return valores.every(valor => /^(50%|100%)(\s*\/\s*(50%|100%))?$/.test(valor));
}

function bloqueDefineEspecificacionDisenoLocal(cuerpo: string): string[] {
  const propiedades = obtenerPropiedadesDiseno(cuerpo);

  if (propiedades.length < 2) {
    return [];
  }

  return Array.from(new Set(propiedades));
}

/*
 * Detecta clases CSS con nombres en ingles.
 * El protocolo requiere nombres en espanol (ej: .contenedor, .boton).
 * Excluye librerias, clases de estado (active, disabled, etc.) y sidebar.
 */
export function verificarNomenclaturaCssIngles(
  texto: string,
  documento: CoreTextDocument,
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
  documento: CoreTextDocument,
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
  documento: CoreTextDocument,
  nombreArchivo: string,
  /* [15A-25] El caller (staticAnalyzer) pasa las roots del proyecto para poder
   * mirar a que elemento se aplica la clase. Sin roots el indice sale vacio y la
   * regla dispara como antes: fail-closed, la falta de evidencia no exime. */
  roots: string[] = [],
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

  const aplicadas = indiceProyecto(roots);
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

    /* [15A-25] El veredicto lo da el elemento que lleva la clase, no el CSS. Si la
     * clase se aplica a un componente y a ningun elemento nativo, es una variante
     * del boton del sistema (su className viaja al <BotonBase>), no un boton hecho
     * a mano. Un bloque CSS no puede ser un boton por si mismo. */
    if (aplicadas.componente.has(claseProblematica) && !aplicadas.nativo.has(claseProblematica)) {
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

/* [085A-4]
 * Detecta controles y submenus locales que recrean recetas visuales del sistema.
 * Gotcha: no basta buscar boton/button; los triggers y dropdowns suelen llamarse
 * Trigger, Lista, Opcion o __dropdown y aun asi definen background, borde,
 * tipografia, padding, transiciones o animaciones que pertenecen a Button,
 * ContextMenu u otra receta canonica.
 */
export function verificarCssEspecificacionDisenoLocal(
  texto: string,
  documento: CoreTextDocument,
  nombreArchivo: string,
): Violacion[] {
  const nombreLower = nombreArchivo.toLowerCase();
  const rutaNorm = documento.fileName.replace(/\\/g, '/');

  if (ARCHIVOS_RECETA_DISENO.has(nombreLower)) {
    return [];
  }

  if (rutaNorm.includes('/node_modules/') || rutaNorm.includes('/vendor/') ||
      rutaNorm.includes('/glory-rs/') || rutaNorm.includes('/public/assets/')) {
    return [];
  }

  if (texto.includes(`sentinel-disable-file ${REGLA_ESPECIFICACION_DISENO_LOCAL}`)) {
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

    if (tieneSentinelDisable(lineas, linea, REGLA_ESPECIFICACION_DISENO_LOCAL)) {
      continue;
    }

    const clasesSelector = Array.from(selector.matchAll(/\.([A-Za-z_][\w-]*)/g)).map(grupo => grupo[1]);
    if (selectorLlevaRecetaInteractiva(clasesSelector)) {
      continue;
    }

    const claseProblematica = clasesSujeto(selector)
      .filter(clase => claseTieneRolInteractivoLocal(clase) && !archivoEsRecetaDeClase(nombreLower, clase))
      .find(clase => PATRONES_ROL_SUPERFICIE.test(clase) || bloqueDeclaraGesto(cuerpo, selector));
    if (!claseProblematica) {
      continue;
    }

    const propiedadesDiseno = bloqueDefineEspecificacionDisenoLocal(cuerpo);
    if (propiedadesDiseno.length === 0) {
      continue;
    }

    violaciones.push({
      reglaId: REGLA_ESPECIFICACION_DISENO_LOCAL,
      mensaje: `La clase CSS ".${claseProblematica}" define especificacion visual local (${propiedadesDiseno.join(', ')}). Usa una receta compartida como Button/ContextMenu/dropdown canonico y deja aqui solo layout contextual.`,
      severidad: obtenerSeveridadRegla(REGLA_ESPECIFICACION_DISENO_LOCAL),
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
  documento: CoreTextDocument,
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

    /* [119A-4 S2] mask-image usa el color como luminancia: cualquier valor
     * opaco vale (#000 es la convencion). No es deuda de design system. */
    const propiedadLinea = /^([\w-]+)\s*:/.exec(linea)?.[1]?.toLowerCase();
    if (propiedadLinea === 'mask-image' || propiedadLinea === '-webkit-mask-image') { continue; }

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
  documento: CoreTextDocument,
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

  /* [15A-25] Una superficie de contenido inyectado (markdown, rich text, un
   * contentEditable) no admite className en sus h2/h3: el marcado lo genera un
   * renderizador, no el JSX del componente. Se reconoce por su FORMA, no por su
   * nombre: si una misma clase estiliza tres o mas elementos crudos distintos en la
   * hoja, es una superficie de contenido y no el marcado propio de un componente.
   * Los nueve hallazgos de KAMPLES eran `.prose` (12 elementos), `.prose-sm`,
   * `.editorArticuloContenido` (4) y `.articuloDetalleContenido` (10); la lista
   * anterior (tiptap|*Texto|*Vacio|*Single) solo acertaba por casualidad del nombre,
   * y de hecho ya eximia a `.tiptap` — que es la misma cosa. */
  const MIN_ELEMENTOS_SUPERFICIE = 3;
  const elementosPorClase = new Map<string, Set<string>>();
  const regexClaseElemento = /\.([\w-]+)\s+(button|h[1-6]|p|ul|ol|li|a|img|blockquote|code|pre|table|hr|strong|em)\b/g;
  let coincidencia: RegExpExecArray | null;

  while ((coincidencia = regexClaseElemento.exec(texto)) !== null) {
    const elementos = elementosPorClase.get(coincidencia[1]) ?? new Set<string>();
    elementos.add(coincidencia[2]);
    elementosPorClase.set(coincidencia[1], elementos);
  }

  function esSuperficieDeContenido(linea: string): boolean {
    for (const clase of Array.from(linea.matchAll(/\.([\w-]+)/g), grupo => grupo[1])) {
      const elementos = elementosPorClase.get(clase);
      if (elementos && elementos.size >= MIN_ELEMENTOS_SUPERFICIE) { return true; }
    }

    return false;
  }

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) { continue; }
    if (tieneSentinelDisable(lineas, i, 'css-elemento-html-directo')) { continue; }

    const match = regexElementoHTML.exec(linea);
    if (!match) { continue; }

    const elemento = match[1];
    if (elemento !== 'button' && excepcionH.test(linea)) { continue; }
    if (esSuperficieDeContenido(linea)) { continue; }

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
