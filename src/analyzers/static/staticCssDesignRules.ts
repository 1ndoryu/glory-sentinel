/*
 * Reglas CSS de especificacion de diseno local del analyzer estatico.
 * [15A-25] Separado de staticCssRules.ts por el budget de tamano (ADR 0001);
 * staticCssRules lo re-exporta para no tocar importadores.
 */

import { Violacion } from '../../types';
import { CoreTextDocument } from '../../core/types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import {
  claseAplicada,
  indiceProyecto,
  IndiceProyecto,
  tieneSentinelDisable,
  tieneSentinelDisableFile,
} from '../../utils/analisisHelpers';
import { conjuntoConstante } from '../../utils/conjuntoConstante';

export const CLASES_BOTON_SISTEMA: ReadonlySet<string> = conjuntoConstante([
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
  /* [15A-26] La hoja que define el dropdown canonico es una hoja de receta, igual
   * que contextmenu.css: en ella viven .dropdownPanel y .dropdownItem, que SON la
   * receta que la regla prescribe ("usa una receta compartida como ... dropdown
   * canonico"). Marcarla era circular. Faltaba en la lista. */
  'dropdownpanel.css',
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
 * — que se abre, se cierra y se posiciona. [15A-27] El nombre solo abre la
 * puerta: el bloque tiene que pintarse como superficie (bloquePintaSuperficie).
 * Una fila de lista, en cambio, no es un control por llamarse `...Item`: eso hay
 * que verlo. */
const PATRONES_ROL_SUPERFICIE = /(?:Trigger|Dropdown|Desplegable|SubMenu|Submenu|Menu|Panel)$/;

/* [15A-25] Si el selector ya lleva una clase del sistema interactivo
 * (`.botonBase.eliminarItem`), el bloque es un MODIFICADOR de esa receta, no una
 * reimplementacion: la clase base ya aporta el aspecto y aqui solo se ajusta. */
function selectorLlevaRecetaInteractiva(clasesSelector: string[]): boolean {
  return clasesSelector.some(clase => CLASES_INTERACTIVAS_BASE.has(clase));
}

/* [15A-25] El bloque declara un gesto propio (puntero, transicion, animacion,
 * posicionamiento o un estado `:hover`/`:focus`/`:active`). Es la evidencia de
 * siempre, y sigue siendo el veredicto cuando el indice del proyecto no puede
 * decir a que elemento se aplica la clase. */
function bloqueDeclaraGesto(cuerpo: string, selector: string): boolean {
  return /cursor\s*:|(?:transition|animation)\s*:|position\s*:\s*(?:absolute|fixed)/i.test(cuerpo)
    || /:(?:hover|focus|focus-visible|active)\b/.test(selector);
}

/* [15A-26] Firma de superficie flotante: fondo + borde + radio + sombra, que es
 * exactamente lo que declara la receta canonica (.dropdownPanel, .menuContextualPanel).
 * Un bloque que la declara esta recreando una superficie, no una fila. */
const FIRMA_SUPERFICIE = [
  /\bbackground(?:-color|-image)?\s*:/i,
  /\bborder\s*:/i,
  /\bborder-radius\s*:/i,
  /\bbox-shadow\s*:/i,
];

function bloqueDeclaraFirmaSuperficie(cuerpo: string): boolean {
  const limpio = cuerpo.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return FIRMA_SUPERFICIE.every(patron => patron.test(limpio));
}

/* [15A-27] Firma MINIMA de superficie: fondo propio y un limite (borde o radio).
 * Es lo que basta para saber que el bloque se PINTA como superficie. No se exige
 * la sombra porque hay superficies flotantes legitimas sin elevacion (un dropdown
 * embebido, un panel dentro de un modal): exigirla convertiria la regla en ciega
 * justo donde mas falta hace. */
const FIRMA_MINIMA_SUPERFICIE = [
  /\bbackground(?:-color|-image)?\s*:/i,
  /\bborder(?:-(?:top|right|bottom|left|color|style|width))?\s*:|\bborder-radius\s*:/i,
];

function bloquePintaSuperficie(cuerpo: string): boolean {
  const limpio = cuerpo.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return FIRMA_MINIMA_SUPERFICIE.every(patron => patron.test(limpio));
}

/* [15A-26] Propiedades que son LAYOUT contextual y no receta visual: son justo las
 * que el mensaje de la regla pide conservar. `padding` lo aporta la receta del
 * sistema por tamano, pero un bloque puede necesitar el suyo; `text-align` no lo
 * declara ninguna receta. */
const PROPIEDADES_LAYOUT_CONTEXTUAL = new Set(['padding', 'text-align']);

/* [15A-26] El bloque no re-declara la receta: solo ajusta layout. */
function bloqueSoloAjustaLayout(cuerpo: string): boolean {
  return obtenerPropiedadesDiseno(cuerpo).every(propiedad => PROPIEDADES_LAYOUT_CONTEXTUAL.has(propiedad));
}

/* [15A-26] El mensaje de la regla prescribe un remedio concreto: "usa una receta
 * compartida como Button/ContextMenu/dropdown canonico". Ese remedio solo existe donde
 * hay un control o una superficie flotante, asi que la regla solo debe disparar ahi:
 *
 *   - el nombre es de familia de superficie (Trigger/Dropdown/Menu/Panel...), o
 *   - el elemento que lleva la clase ES un control: etiqueta nativa de control, o un
 *     componente del sistema (<BotonBase>, <Checkbox>, <Radio>...), o
 *   - el elemento SE OPERA (manejador `on` o rol interactivo), aunque sea un <div>, o
 *   - esta sobre un elemento llano pero su bloque declara la firma de superficie.
 *
 * Una fila de lista que solo se ilumina al pasar el raton no tiene receta canonica a la
 * que plegarse: su hallazgo no tiene remedio aplicable, y un hallazgo cuyo remedio no es
 * aplicable no es un hallazgo, es ruido (mismo criterio que modalTitulo/modalAcciones en
 * analisisHelpers). Esa deuda — filas con especificacion visual local — queda SIN
 * REPORTAR a proposito, y asi esta anotado en el roadmap de KAMPLES.
 *
 * FAIL-CLOSED: si el indice no ha visto la clase en NINGUNA etiqueta (clase dinamica,
 * fichero fuera del barrido, o llamada sin roots), se cae al veredicto de siempre
 * (`bloqueDeclaraGesto`): la falta de evidencia no exime. */
function recetaAplicable(
  clase: string,
  selector: string,
  cuerpo: string,
  indice: IndiceProyecto,
): boolean {
  /* [15A-27] El nombre de familia abre la puerta, pero no decide: exige que el
   * bloque se pinte como superficie. Un contenedor de layout llamado `...Panel`
   * (padding, flex, tipografia, sin fondo ni borde) no declara superficie ninguna,
   * asi que no hay receta a la que plegarlo: mismo criterio de ruido que el resto.
   * Si el bloque si se pinta, sigue el veredicto de siempre. */
  if (PATRONES_ROL_SUPERFICIE.test(clase)) {
    return bloquePintaSuperficie(cuerpo);
  }

  if (claseAplicada(clase, indice.control, indice.prefijosControl)) {
    return true;
  }

  /* [15A-26] El elemento YA es un componente del sistema o un control de facto: la
   * receta esta en uso. Si el bloque no re-declara nada de la receta y solo ajusta
   * layout, es literalmente lo que el mensaje pide conservar ("deja aqui solo layout
   * contextual"), asi que marcarlo deja al autor sin salida: cualquier padding lo
   * volveria a marcar. */
  if (claseAplicada(clase, indice.componente, indice.prefijosComponente)
      || claseAplicada(clase, indice.operado, indice.prefijosOperado)) {
    return !bloqueSoloAjustaLayout(cuerpo);
  }

  if (claseAplicada(clase, indice.nativo, indice.prefijosNativo)) {
    return bloqueDeclaraFirmaSuperficie(cuerpo);
  }

  return bloqueDeclaraGesto(cuerpo, selector);
}

/* [15A-25] El sujeto de un selector es el ultimo compuesto de cada parte separada
 * por comas: en `.tarjetaColeccionLista .tarjetaColeccionPortada img` el bloque
 * estiliza `img`, no `.tarjetaColeccionLista`. La regla tomaba la PRIMERA clase con
 * rol de todo el selector y culpaba al ancestro. */
/* [15A-27] Un pseudo-elemento de PROVEEDOR (`::-webkit-scrollbar-thumb` y
 * compania) no es el sujeto de la clase: estiliza una pieza interna del
 * navegador —la barra de scroll, su riel, su pulgar—, no la piel del elemento
 * que la contiene. `.dropdown::-webkit-scrollbar-thumb { background; border-radius }`
 * no reimplementa la receta del dropdown. Los pseudo-elementos de CONTENIDO
 * (`::before`, `::after`) siguen contando: ahi el bloque crea decoracion propia
 * del elemento, y eso si es especificacion local (ver el testigo de
 * `.selectorIdiomaLista::before`). */
const RE_PSEUDO_PROVEEDOR = /::-(?:webkit|moz|ms)-[\w-]+/;

function clasesSujeto(selector: string): string[] {
  const clases: string[] = [];

  for (const parte of selector.split(',')) {
    const ultimoCompuesto = parte.trim().split(/[\s>+~]+/).pop() ?? '';
    if (RE_PSEUDO_PROVEEDOR.test(ultimoCompuesto)) { continue; }
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
  /* [15A-26] El caller pasa las roots del proyecto para saber a que elemento se aplica
   * cada clase. Sin roots el indice sale vacio y la regla dispara como antes:
   * fail-closed, la falta de evidencia no exime. */
  roots: string[] = [],
): Violacion[] {
  const nombreLower = nombreArchivo.toLowerCase();
  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  const indice = indiceProyecto(roots);

  if (ARCHIVOS_RECETA_DISENO.has(nombreLower)) {
    return [];
  }

  if (rutaNorm.includes('/node_modules/') || rutaNorm.includes('/vendor/') ||
      rutaNorm.includes('/glory-rs/') || rutaNorm.includes('/public/assets/')) {
    return [];
  }

  if (tieneSentinelDisableFile(texto, REGLA_ESPECIFICACION_DISENO_LOCAL)) {
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
      .find(clase => recetaAplicable(clase, selector, cuerpo, indice));
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
