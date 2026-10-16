/*
 * Helpers compartidos para los analyzers de Code Sentinel.
 * Centraliza patrones repetidos: skip de comentarios, sentinel-disable,
 * exclusion Glory/, hash de contenido, etc.
 * Reduce boilerplate en ~30 funciones de reglas.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CoreTextDocument } from '../core/types';

/*
 * Retorna true si la linea es un comentario (PHP, JS/TS, CSS).
 * Cubre: //, #, /*, *, docblocks (/**).
 */
export function esComentario(linea: string): boolean {
  const trim = linea.trim();
  return (
    trim.startsWith('//') ||
    trim.startsWith('*') ||
    trim.startsWith('/*') ||
    trim.startsWith('#')
  );
}

/* Retorna true si alguna de las 5 lineas previas a `indice` contiene
 * `sentinel-disable-next-line <reglaId>`, sin importar que haya lineas de
 * codigo entre el disable y la linea reportada.
 * El scan atraviesa lineas vacias, comentarios (/* ... *\/ // ...) y codigo:
 * en JSX el disable suele colocarse sobre el bloque contenedor mientras la
 * regla reporta una linea interna (ej: disable sobre <div>, violacion en el
 * <h3> de dentro — caso SeccionPagos [259A-5]). La ventana de 5 lineas acota
 * el alcance: un disable a 6+ lineas no suprime nada.
 * [25A-SENT-FP] Los bloques de comentario multi-linea siguen cubiertos porque
 * el scan no se detiene en lineas intermedias. */
export function tieneSentinelDisable(lineas: string[], indice: number, reglaId: string): boolean {
  for (let k = indice - 1; k >= 0 && k >= indice - 5; k--) {
    const linea = lineas[k] ?? '';
    if (linea.includes(`sentinel-disable-next-line ${reglaId}`)) { return true; }
  }
  return false;
}

/* Separadores validos entre ids en un `sentinel-disable-file` multi-regla:
 * `/* sentinel-disable-file regla-a regla-b: motivo *\/ */
const SEPARADORES_DISABLE_FILE = /[\s:;,(){}[\]"'`]+/;

/* Retorna true si el texto contiene `sentinel-disable-file <reglaId>` con el
 * id como token exacto en su misma linea. El match por token evita la
 * supresion cruzada por substring: deshabilitar `componente-sin-hook-glory`
 * no debe eximir `componente-sin-hook` ni viceversa (caso DeploymentRow /
 * PlanFeatureTooltip [259A-5], antes vivos por accidente). Un `sentinel-disable-file`
 * sin ids (bare) no exime ninguna regla. */
export function tieneSentinelDisableFile(texto: string, reglaId: string): boolean {
  const prefijo = 'sentinel-disable-file';
  let desde = 0;
  /* [289A-1] Sin while(true): no-constant-condition dejaba lint en rojo y
   * bloqueaba la certificacion del release. Misma semantica. */
  let idx = texto.indexOf(prefijo, desde);
  while (idx >= 0) {
    const finLinea = texto.indexOf('\n', idx);
    const segmento = texto.slice(idx + prefijo.length, finLinea < 0 ? undefined : finLinea);
    const tokens = segmento.split(SEPARADORES_DISABLE_FILE).filter(Boolean);
    if (tokens.includes(reglaId)) { return true; }
    desde = idx + prefijo.length;
    idx = texto.indexOf(prefijo, desde);
  }
  return false;
}

/*
 * Retorna true si la ruta pertenece al framework Glory/
 * (que tiene su propia arquitectura y no debe analizarse con reglas del proyecto).
 */
/* [119A-4 S7] /glory-core/ es codigo del framework: sus <button>/<input>
 * nativos SON los componentes que las reglas piden usar, asi que se exime
 * igual que /Glory/. */
export function esRutaGlory(ruta: string): boolean {
  const normalizada = ruta.replace(/\\/g, '/');
  return normalizada.includes('/Glory/') || normalizada.includes('/glory-core/');
}

/*
 * Calcula hash MD5 del contenido.
 * Usado por debounceService y cacheService para detectar cambios.
 */
export function calcularHash(contenido: string): string {
  return crypto.createHash('md5').update(contenido).digest('hex');
}

/* [119A-4 S4] Clases canonicas del sistema Modal que las reglas
 * modal-*-no-canonica presuponen. Si el proyecto no define ninguna, sugerir
 * "usa modalAcciones/modalTexto/..." es un falso positivo: no hay sistema. */
const CLASES_MODAL_CANONICAS_BUSQUEDA = /\.modal(?:Acciones|Formulario|Campo|Titulo|Texto)\b/;
const DIRS_MODAL_SKIP = new Set([
  'node_modules', 'vendor', 'dist', 'build', '.git', 'coverage',
  '.quality-tools', '.sentinel', '.quality-reports', 'target',
]);
const cacheModalCanonico = new Map<string, boolean>();

function contieneClaseModalCanonica(dir: string): boolean {
  let entries: import('fs').Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (DIRS_MODAL_SKIP.has(entry.name)) { continue; }
    const ruta = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (contieneClaseModalCanonica(ruta)) { return true; }
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      let texto: string;
      try {
        texto = fs.readFileSync(ruta, 'utf8');
      } catch {
        continue;
      }
      if (CLASES_MODAL_CANONICAS_BUSQUEDA.test(texto)) { return true; }
    }
  }
  return false;
}

/*
 * [119A-4 S4] Retorna true si el proyecto define al menos una clase canonica
 * de Modal (.modalAcciones/.modalFormulario/.modalCampo/.modalTitulo/.modalTexto).
 * Fail-closed: sin roots configurados no se puede afirmar la ausencia, asi que
 * retorna true (las reglas siguen disparando como antes). Resultado con cache
 * por conjunto de roots; el recorrido para en el primer CSS con coincidencia.
 */
export function proyectoTieneModalCanonico(roots: string[]): boolean {
  const normalizados = roots.map(r => r.replace(/\\/g, '/').replace(/\/+$/, '')).filter(Boolean);
  if (normalizados.length === 0) { return true; }
  const clave = normalizados.join('|');
  const cached = cacheModalCanonico.get(clave);
  if (cached !== undefined) { return cached; }
  const tiene = normalizados.some(root => contieneClaseModalCanonica(root));
  cacheModalCanonico.set(clave, tiene);
  return tiene;
}

/* [15A-25] Varias reglas emitian veredictos que el CSS por si solo no puede sostener:
 * `css-adhoc-button-style` marcaba como boton hecho a mano cualquier bloque con
 * `cursor: pointer` y una clase `*boton*`, cuando en KAMPLES los 31 bloques son
 * variantes aplicadas a <BotonBase>; `modal-acciones-no-canonico` marcaba cualquier
 * clase `*Acciones` dentro de un <Modal>, cuando tres de las cuatro no son la zona
 * de botones sino una barra de cabecera o un pie con borde propio; y
 * `modal-estructura-no-canonica` avisaba de que una className "redefine el
 * contenedor" cuando <Modal> la APPENDEA a las suyas.
 *
 * Un unico recorrido del proyecto (JSX y CSS) construye el indice que necesitan, con
 * cache por conjunto de roots. Un solo recorrido porque cada regla hace su propia
 * pregunta sobre el mismo material. */
export interface IndiceProyecto {
  /* Clases aplicadas a un COMPONENTE (<BotonBase ... className=...>). */
  componente: Set<string>;
  /* Clases aplicadas a un elemento NATIVO (<button ...>). */
  nativo: Set<string>;
  /* [15A-26] Subconjunto de `nativo`: clases aplicadas a un CONTROL
   * (<button>, <a>, <input>, <select>, <textarea>, <summary>). La regla
   * `css-especificacion-diseno-local` prescribe "usa una receta compartida como
   * Button": eso solo es aplicable donde hay un control. */
  control: Set<string>;
  /* [15A-26] Clases aplicadas a un elemento que SE OPERA: lleva un manejador `on*`
   * o declara un rol interactivo. Un `<div onClick>` es un boton de facto y la
   * receta si aplica. */
  operado: Set<string>;
  /* Cuerpo de cada bloque CSS, por clase: una clase puede definirse en varias hojas. */
  cuerposCss: Map<string, string[]>;
  /* El <Modal> del proyecto fusiona la className recibida con las suyas. */
  modalFusionaClassName: boolean;
  /* [15A-27] Identificador -> fragmentos de clase, para las clases que NO se
   * escriben como literal en el `className` sino que se arman antes:
   * `const clases = ['botonLike', ...]` en el propio fichero, o el array que
   * devuelve un hook en un `.ts` (`useBotonFollow.ts:51` -> `clases`). Sin esto
   * la clase quedaba invisible para el indice y la regla no podia ver sobre que
   * elemento se aplica. */
  aliasClases: Map<string, Set<string>>;
  /* [15A-27] Enlaces del PROPIO fichero, que mandan sobre la union global: el
   * identificador `clases` se repite en medio centenar de ficheros, asi que la
   * union sola resolveria unos con los fragmentos de otros. */
  enlacesPorFichero: Map<string, Map<string, EnlaceClases>>;
  /* [15A-27] La misma union, para los prefijos de plantilla que viajan dentro
   * de un enlace (`['botonFollow', \`botonFollow-${tamano}\`]`). */
  aliasPrefijos: Map<string, Set<string>>;
  /* [15A-27] Prefijos de clase que el JSX arma con plantilla:
   * `` `botonFollow-${tamano}` `` produce `.botonFollow-sm` o `.botonFollow-md`
   * segun el valor, que no esta en el literal. El sufijo es dinamico y no se
   * puede enumerar, pero el prefijo si es literal, asi que la clase cuenta como
   * aplicada si empieza por el. Uno por cajon: el prefijo solo exime donde el
   * elemento que lo lleva es de ese tipo. */
  prefijosComponente: Set<string>;
  prefijosNativo: Set<string>;
  prefijosControl: Set<string>;
  prefijosOperado: Set<string>;
}

/* [15A-27] Lo que un enlace (`const clases = ...`) aporta: las clases literales
 * y los prefijos de las plantillas que arma. */
interface EnlaceClases {
  clases: string[];
  prefijos: string[];
}

/* [15A-27] Pertenencia al indice con prefijos: `clase` cuenta si esta aplicada
 * tal cual o si empieza por un prefijo que el proyecto arma con plantilla. */
export function claseAplicada(clase: string, aplicadas: Set<string>, prefijos: Set<string>): boolean {
  if (aplicadas.has(clase)) { return true; }

  for (const prefijo of prefijos) {
    if (clase.startsWith(prefijo)) { return true; }
  }

  return false;
}

const DIRS_FUENTES_SKIP = new Set([
  'node_modules', 'vendor', 'dist', 'build', '.git', 'coverage',
  '.quality-tools', '.sentinel', '.quality-reports', 'target',
]);
const RE_TAG_JSX = /<([A-Za-z][\w.]*)([^<>]*?)\/?>/g;
const RE_CLASSNAME_JSX = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([\s\S]*?)\})/g;
/* [15A-26] Etiquetas nativas que SON un control: ahi la receta de boton del sistema
 * es aplicable tal cual. */
const TAGS_CONTROL = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary']);
/* [15A-26] El elemento SE OPERA: tiene un manejador `on*` o declara un rol
 * interactivo. Un <div onClick> es un boton de facto. */
const RE_ATRIBUTO_OPERADO = /\bon[A-Z]\w*\s*=|\brole\s*=\s*['"]?(?:button|menuitem|option|tab|link)\b/;
const RE_BLOQUE_CSS = /([^{}]+)\{([^{}]*)\}/g;
/* [15A-25] Evidencia de que el <Modal> del proyecto FUSIONA la className recibida
 * con la del contenedor en vez de reemplazarla. Son las tres formas de componer una
 * cadena de clases que usa el sistema: array literal (`['modalContenedor',
 * mapaTamano[tamano], className]`, Modal.tsx:80), plantilla y concatenacion. La
 * primera admite un nivel de anidamiento porque los arrays llevan indexaciones
 * dentro (`mapaTamano[tamano]`), que un `[^\]]*` no cruza: la version anterior de
 * esta regex no casaba con NINGUN modal real y el veredicto quedaba muerto. */
const RE_MODAL_FUSIONA = [
  /\[(?:[^[\]]|\[[^[\]]*\])*\bclassName\b(?:[^[\]]|\[[^[\]]*\])*\]/,
  /`[^`]*\$\{[^}]*\bclassName\b[^}]*\}[^`]*`/,
  /['"][^'"]+['"]\s*\+\s*\bclassName\b/,
  /\bclassName\b\s*\+\s*['"]/,
];
const cacheIndice = new Map<string, IndiceProyecto>();
/* [15A-27] Enlace de un identificador a un literal de cadena o a un array de
 * fragmentos. Se admite un nivel de anidamiento porque los arrays reales llevan
 * indexaciones dentro (`mapaTamano[tamano]`), que un `[^\]]*` no cruza. */
const RE_ENLACE_CLASES = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\[(?:[^[\]]|\[[^[\]]*\])*\]|`[^`]*`|'[^']*'|"[^"]*")/g;

/* Fragmentos de clase de un literal: mismo criterio que el `className`, se toman
 * todos los identificadores con pinta de clase y sobra alguna palabra suelta. */
function fragmentosDeClases(valor: string): string[] {
  return valor.split(/[^A-Za-z0-9_-]+/).filter(Boolean);
}

/* [15A-27] Prefijo literal de una plantilla con interpolacion. Se exige que el
 * literal acabe en separador (`-` o `_`): `` `boton${x}` `` daria el prefijo
 * `boton`, que eximiria medio proyecto, mientras que `` `botonFollow-${x}` ``
 * nombra una familia concreta. */
const RE_PREFIJO_PLANTILLA = /`([A-Za-z][\w-]*[-_])\$\{/g;

function prefijosDeClases(valor: string): string[] {
  const prefijos: string[] = [];

  RE_PREFIJO_PLANTILLA.lastIndex = 0;
  let plantilla: RegExpExecArray | null;
  while ((plantilla = RE_PREFIJO_PLANTILLA.exec(valor)) !== null) {
    prefijos.push(plantilla[1]);
  }

  return prefijos;
}

/* [15A-27] Recoge los enlaces del fichero. Se aplica tambien a `.ts`/`.js`, que
 * no llevan JSX pero si los arrays de clases que devuelven los hooks. Se guardan
 * en dos sitios: el mapa del fichero, que resuelve con exactitud, y la union del
 * proyecto, que resuelve los enlaces importados de otro modulo. */
function indexarEnlaces(ruta: string, indice: IndiceProyecto): void {
  let texto: string;
  try {
    texto = fs.readFileSync(ruta, 'utf8');
  } catch {
    return;
  }

  RE_ENLACE_CLASES.lastIndex = 0;
  let enlace: RegExpExecArray | null;
  while ((enlace = RE_ENLACE_CLASES.exec(texto)) !== null) {
    const aporta: EnlaceClases = {
      clases: fragmentosDeClases(enlace[2]),
      prefijos: prefijosDeClases(enlace[2]),
    };

    const propios = indice.enlacesPorFichero.get(ruta) ?? new Map<string, EnlaceClases>();
    propios.set(enlace[1], aporta);
    indice.enlacesPorFichero.set(ruta, propios);

    const union = indice.aliasClases.get(enlace[1]) ?? new Set<string>();
    for (const fragmento of aporta.clases) { union.add(fragmento); }
    indice.aliasClases.set(enlace[1], union);

    const unionPrefijos = indice.aliasPrefijos.get(enlace[1]) ?? new Set<string>();
    for (const prefijo of aporta.prefijos) { unionPrefijos.add(prefijo); }
    indice.aliasPrefijos.set(enlace[1], unionPrefijos);
  }
}

function indexarJsx(ruta: string, indice: IndiceProyecto): void {
  let texto: string;
  try {
    texto = fs.readFileSync(ruta, 'utf8');
  } catch {
    return;
  }

  if (/[\\/]Modal\.(?:tsx|jsx)$/.test(ruta) && RE_MODAL_FUSIONA.some(re => re.test(texto))) {
    indice.modalFusionaClassName = true;
  }

  /* [15A-27] Los enlaces propios del fichero mandan; la union global solo entra
   * para los identificadores que no se declaran aqui (el array que devuelve un
   * hook importado). */
  const propios = indice.enlacesPorFichero.get(ruta);
  const resolver = (token: string): EnlaceClases => {
    const local = propios?.get(token);
    if (local) { return local; }

    const clases = indice.aliasClases.get(token);
    const prefijos = indice.aliasPrefijos.get(token);
    if (!clases && !prefijos) { return { clases: [], prefijos: [] }; }

    return { clases: Array.from(clases ?? []), prefijos: Array.from(prefijos ?? []) };
  };

  RE_TAG_JSX.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = RE_TAG_JSX.exec(texto)) !== null) {
    const etiqueta = tag[1];
    const destino = /^[A-Z]/.test(etiqueta) ? indice.componente : indice.nativo;
    const esControl = TAGS_CONTROL.has(etiqueta);
    const seOpera = RE_ATRIBUTO_OPERADO.test(tag[2]);

    RE_CLASSNAME_JSX.lastIndex = 0;
    let atributo: RegExpExecArray | null;
    while ((atributo = RE_CLASSNAME_JSX.exec(tag[2])) !== null) {
      /* El valor puede ser un literal o una expresion (`clsx('x', cond && 'y')`):
       * se toman todos los identificadores con pinta de clase. Sobra alguna palabra
       * suelta, pero el veredicto queda del lado conservador. */
      const valor = atributo[1] ?? atributo[2] ?? atributo[3] ?? '';
      /* Los prefijos de plantilla viajan con el enlace: `botonFollow-` puede
       * estar escrito aqui o dentro del array al que apunta `clases`. */
      const prefijos = prefijosDeClases(valor);

      for (const token of valor.split(/[^A-Za-z0-9_-]+/)) {
        if (!token) { continue; }
        /* [15A-27] Si el token es un enlace (`clases`), valen tambien las clases
         * y los prefijos a los que apunta: estan aplicados a ESTE elemento
         * aunque no se escriban aqui. */
        const enlace = resolver(token);
        for (const clase of [token, ...enlace.clases]) {
          destino.add(clase);
          if (esControl) { indice.control.add(clase); }
          if (seOpera) { indice.operado.add(clase); }
        }
        prefijos.push(...enlace.prefijos);
      }

      /* [15A-27] Los prefijos van al cajon del elemento que los lleva: un
       * `` `botonFollow-${tamano}` `` sobre un <BotonBase> exime
       * `.botonFollow-sm`; el mismo literal sobre un <button> nativo, no. */
      for (const prefijo of prefijos) {
        if (destino === indice.componente) { indice.prefijosComponente.add(prefijo); }
        else { indice.prefijosNativo.add(prefijo); }
        if (esControl) { indice.prefijosControl.add(prefijo); }
        if (seOpera) { indice.prefijosOperado.add(prefijo); }
      }
    }
  }
}

function indexarCss(ruta: string, indice: IndiceProyecto): void {
  let texto: string;
  try {
    texto = fs.readFileSync(ruta, 'utf8');
  } catch {
    return;
  }

  RE_BLOQUE_CSS.lastIndex = 0;
  let bloque: RegExpExecArray | null;
  while ((bloque = RE_BLOQUE_CSS.exec(texto)) !== null) {
    const selector = bloque[1].replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    if (!selector || selector.startsWith('@')) { continue; }

    for (const clase of new Set(Array.from(selector.matchAll(/\.([A-Za-z_][\w-]*)/g), grupo => grupo[1]))) {
      const cuerpos = indice.cuerposCss.get(clase) ?? [];
      cuerpos.push(bloque[2]);
      indice.cuerposCss.set(clase, cuerpos);
    }
  }
}

const RE_FUENTE_JS = /\.(?:ts|tsx|js|jsx)$/;

function listarFuentes(dir: string, salida: string[]): void {
  let entries: import('fs').Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (DIRS_FUENTES_SKIP.has(entry.name)) { continue; }
    const ruta = path.join(dir, entry.name);
    if (entry.isDirectory()) { listarFuentes(ruta, salida); }
    else if (entry.isFile()) { salida.push(ruta); }
  }
}

function recorrerFuentes(dir: string, indice: IndiceProyecto): void {
  const ficheros: string[] = [];
  listarFuentes(dir, ficheros);

  /* [15A-27] Dos pasadas: primero los enlaces (`const clases = [...]`), que
   * pueden vivir en un `.ts` sin JSX —el hook que devuelve la lista de clases—,
   * y despues el JSX, que ya los ve resueltos. */
  for (const fichero of ficheros) {
    if (RE_FUENTE_JS.test(fichero)) { indexarEnlaces(fichero, indice); }
  }

  for (const fichero of ficheros) {
    if (/\.(?:tsx|jsx)$/.test(fichero)) { indexarJsx(fichero, indice); }
    else if (fichero.endsWith('.css')) { indexarCss(fichero, indice); }
  }
}

export function indiceProyecto(roots: string[]): IndiceProyecto {
  const normalizados = roots.map(r => r.replace(/\\/g, '/').replace(/\/+$/, '')).filter(Boolean);
  const clave = normalizados.join('|');
  const cached = cacheIndice.get(clave);
  if (cached) { return cached; }

  const indice: IndiceProyecto = {
    componente: new Set(),
    nativo: new Set(),
    control: new Set(),
    operado: new Set(),
    cuerposCss: new Map(),
    modalFusionaClassName: false,
    aliasClases: new Map(),
    aliasPrefijos: new Map(),
    enlacesPorFichero: new Map(),
    prefijosComponente: new Set(),
    prefijosNativo: new Set(),
    prefijosControl: new Set(),
    prefijosOperado: new Set(),
  };
  for (const root of normalizados) {
    recorrerFuentes(root, indice);
  }
  cacheIndice.set(clave, indice);
  return indice;
}

/* [15A-25] Solo se detectan los sufijos cuyo destino canonico EXISTE en el sistema:
 * .modalTitulo (barra compacta del <Modal>, modal.css) y .modalAcciones
 * (modalAcciones.css). `modalTexto` figuraba en la lista pero no esta definido en
 * ninguna hoja del proyecto, de modo que la regla prescribia una clase inexistente.
 * Un hallazgo cuyo remedio no es aplicable no es un hallazgo, es ruido.
 * Vive aqui, y no en la regla CSS, porque la regla de JSX necesita el mismo
 * veredicto sobre el mismo bloque (ver modal-acciones-no-canonico). */
export function sufijoSemanticoModal(nombreClase: string): 'Titulo' | 'Acciones' | null {
  if (nombreClase === 'modalTitulo' || nombreClase === 'modalAcciones') {
    return null;
  }

  const match = /(?:^modal[A-Z][\w-]*|^[A-Za-z][\w-]*Modal)(Titulo|Acciones)$/.exec(nombreClase);
  return (match?.[1] as 'Titulo' | 'Acciones' | undefined) ?? null;
}

export function claseCanonicaModal(sufijo: 'Titulo' | 'Acciones'): 'modalTitulo' | 'modalAcciones' {
  return sufijo === 'Titulo' ? 'modalTitulo' : 'modalAcciones';
}

/* [15A-25] La regla solo debe disparar cuando la clase local reescribe la receta
 * canonica y NO declara ademas un rol que esa receta no puede expresar. Los casos de
 * KAMPLES declaraban justamente eso, de modo que seguir la recomendacion habria
 * cambiado el render:
 * - .modalTitulo es la barra compacta de 13px, sin peso y alineada a la izquierda
 *   (modal.css:53-57). Un bloque que se centra, se pone en mayusculas o declara peso
 *   esta definiendo una cabecera de cuerpo.
 * - .modalAcciones es `display:flex; gap` y da flex:1 a sus hijos
 *   (modalAcciones.css:13-15). Un bloque que anade justify-content, flex-wrap,
 *   border-top, padding o un ancho esta maquetando un pie que la receta no
 *   contempla, y el flex:1 encogeria los botones. */
export function bloqueDefineSemanticaModal(cuerpo: string, sufijo: 'Titulo' | 'Acciones'): boolean {
  const cuerpoLimpio = cuerpo.replace(/\/\*[\s\S]*?\*\//g, ' ');

  if (sufijo === 'Acciones') {
    /* El guion cubre las familias `padding-top`, `margin-bottom`, `max-width`... */
    if (/(?:justify-content|flex-wrap|border-top|padding|margin|width|max-width|min-width|align-items|flex-direction|position)\s*[-:]/i.test(cuerpoLimpio)) {
      return false;
    }

    return /(display\s*:\s*flex|gap\s*:)/i.test(cuerpoLimpio);
  }

  if (/(?:text-align\s*:\s*center|text-transform)\s*:/i.test(cuerpoLimpio)) {
    return false;
  }

  if (/font-weight\s*:\s*(?:bold|[6-9]00|var\(--peso(?:Semi)?Bold\))/i.test(cuerpoLimpio)) {
    return false;
  }

  return /(font-size\s*:|font-family\s*:|font-weight\s*:|line-height\s*:|color\s*:|text-align\s*:|letter-spacing\s*:|margin(?:-top|-bottom)?\s*:)/i.test(cuerpoLimpio);
}

/*
 * Extrae las lineas de texto de un documento VS Code.
 */
export function obtenerLineas(documento: CoreTextDocument): string[] {
  return documento.getText().split('\n');
}

/*
 * Normaliza una ruta reemplazando backslashes por forward slashes.
 */
export function normalizarRuta(ruta: string): string {
  return ruta.replace(/\\/g, '/');
}
