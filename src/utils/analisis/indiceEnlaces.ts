/* Indexado de enlaces de clases en fuentes JS/TS (literales, arrays, plantillas, imports). Extraido de src/utils/analisisHelpers.ts (fachada). */
import { AliasModulo, EnlaceClases, IndiceProyecto, OrigenEnlace } from './indiceTipos';
import { normalizarRuta } from './rutasYContenido';
import { resolverModulo } from './indiceAlias';
import * as fs from 'fs';
import { conjuntoConstante } from '../conjuntoConstante';

export const RE_TAG_JSX = /<([A-Za-z][\w.]*)([^<>]*?)\/?>/g;
export const RE_CLASSNAME_JSX = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([\s\S]*?)\})/g;
/* [15A-26] Etiquetas nativas que SON un control: ahi la receta de boton del sistema
 * es aplicable tal cual. */
export const TAGS_CONTROL: ReadonlySet<string> = conjuntoConstante(['button', 'a', 'input', 'select', 'textarea', 'summary']);
/* [15A-26] El elemento SE OPERA: tiene un manejador `on*` o declara un rol
 * interactivo. Un <div onClick> es un boton de facto. */
export const RE_ATRIBUTO_OPERADO = /\bon[A-Z]\w*\s*=|\brole\s*=\s*['"]?(?:button|menuitem|option|tab|link)\b/;
export const RE_BLOQUE_CSS = /([^{}]+)\{([^{}]*)\}/g;
/* [15A-25] Evidencia de que el <Modal> del proyecto FUSIONA la className recibida
 * con la del contenedor en vez de reemplazarla. Son las tres formas de componer una
 * cadena de clases que usa el sistema: array literal (`['modalContenedor',
 * mapaTamano[tamano], className]`, Modal.tsx:80), plantilla y concatenacion. La
 * primera admite un nivel de anidamiento porque los arrays llevan indexaciones
 * dentro (`mapaTamano[tamano]`), que un `[^\]]*` no cruza: la version anterior de
 * esta regex no casaba con NINGUN modal real y el veredicto quedaba muerto. */
export const RE_MODAL_FUSIONA = [
  /\[(?:[^[\]]|\[[^[\]]*\])*\bclassName\b(?:[^[\]]|\[[^[\]]*\])*\]/,
  /`[^`]*\$\{[^}]*\bclassName\b[^}]*\}[^`]*`/,
  /['"][^'"]+['"]\s*\+\s*\bclassName\b/,
  /\bclassName\b\s*\+\s*['"]/,
];
/* [15A-27] Enlace de un identificador a un literal de cadena o a un array de
 * fragmentos. Se admite un nivel de anidamiento porque los arrays reales llevan
 * indexaciones dentro (`mapaTamano[tamano]`), que un `[^\]]*` no cruza. */
const RE_ENLACE_CLASES = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\[(?:[^[\]]|\[[^[\]]*\])*\]|`[^`]*`|'[^']*'|"[^"]*")/g;

/* [15A-27] Formas de import que traen un identificador del que puede colgar un
 * enlace de clases, y la desestructuracion de una llamada a uno de ellos. */
const RE_IMPORT_NOMBRADOS = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const RE_IMPORT_DEFECTO = /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s*['"]([^'"]+)['"]/g;
const RE_DESTRUCTURA_LLAMADA = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([A-Za-z_$][\w$]*)\s*\(/g;

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

export function prefijosDeClases(valor: string): string[] {
  const prefijos: string[] = [];

  RE_PREFIJO_PLANTILLA.lastIndex = 0;
  let plantilla: RegExpExecArray | null;
  while ((plantilla = RE_PREFIJO_PLANTILLA.exec(valor)) !== null) {
    prefijos.push(plantilla[1]);
  }

  return prefijos;
}

/* [15A-27] Recoge los enlaces del fichero. Se aplica tambien a `.ts`/`.js`, que
 * no llevan JSX pero si los arrays de clases que devuelven los hooks. */
export function indexarEnlaces(ruta: string, indice: IndiceProyecto, alias: AliasModulo[]): void {
  let texto: string;
  try {
    texto = fs.readFileSync(ruta, 'utf8');
  } catch {
    return;
  }

  const clave = normalizarRuta(ruta);

  RE_ENLACE_CLASES.lastIndex = 0;
  let enlace: RegExpExecArray | null;
  while ((enlace = RE_ENLACE_CLASES.exec(texto)) !== null) {
    const propios = indice.enlacesPorFichero.get(clave) ?? new Map<string, EnlaceClases>();
    propios.set(enlace[1], {
      clases: fragmentosDeClases(enlace[2]),
      prefijos: prefijosDeClases(enlace[2]),
    });
    indice.enlacesPorFichero.set(clave, propios);
  }

  const origenes = indice.origenesPorFichero.get(clave) ?? new Map<string, OrigenEnlace>();
  indice.origenesPorFichero.set(clave, origenes);

  /* 1. `import { a, b as c } from './modulo'`: cada nombre entra apuntando al
   * modulo que lo exporta. */
  RE_IMPORT_NOMBRADOS.lastIndex = 0;
  let importacion: RegExpExecArray | null;
  while ((importacion = RE_IMPORT_NOMBRADOS.exec(texto)) !== null) {
    const modulo = resolverModulo(ruta, importacion[2], alias);
    if (!modulo) { continue; }

    for (const bruto of importacion[1].split(',')) {
      const [exportado, apodo] = bruto.split(/\s+as\s+/).map(parte => parte.trim());
      if (exportado) { origenes.set(apodo || exportado, { modulo, nombre: exportado }); }
    }
  }

  RE_IMPORT_DEFECTO.lastIndex = 0;
  while ((importacion = RE_IMPORT_DEFECTO.exec(texto)) !== null) {
    const modulo = resolverModulo(ruta, importacion[2], alias);
    if (modulo) { origenes.set(importacion[1], { modulo, nombre: 'default' }); }
  }

  /* 2. `const { clases } = useBotonFollow(...)`: el enlace no lo declara este
   * fichero, lo devuelve el hook — que si lo declara, en su modulo. Se hereda el
   * origen del hook y se busca alli el nombre desestructurado. */
  RE_DESTRUCTURA_LLAMADA.lastIndex = 0;
  while ((importacion = RE_DESTRUCTURA_LLAMADA.exec(texto)) !== null) {
    const origen = origenes.get(importacion[2].trim());
    if (!origen) { continue; }

    for (const bruto of importacion[1].split(',')) {
      const nombre = bruto.split(':')[0]?.trim();
      if (nombre) { origenes.set(nombre, { modulo: origen.modulo, nombre }); }
    }
  }
}
