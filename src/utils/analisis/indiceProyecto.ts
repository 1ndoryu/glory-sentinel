/* Construccion del indice de clases del proyecto y su cache. Extraido de src/utils/analisisHelpers.ts (fachada). */
import { DIRS_FUENTES_SKIP, indexarEnlaces } from './indiceEnlaces';
import { IndiceProyecto } from './indiceTipos';
import { leerAliases } from './indiceAlias';
import { indexarCss, indexarJsx } from './indiceJsxCss';
import * as fs from 'fs';
import * as path from 'path';

/* Cache por conjunto de roots: el indice se reconstruye solo si cambian. Solo lo usa este modulo. */
const cacheIndice = new Map<string, IndiceProyecto>();
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
    enlacesPorFichero: new Map(),
    origenesPorFichero: new Map(),
    prefijosComponente: new Set(),
    prefijosNativo: new Set(),
    prefijosControl: new Set(),
    prefijosOperado: new Set(),
  };

  /* [15A-27] El arbol se lista una vez y los alias se leen ANTES de indexar: para
   * seguir un `import` hay que conocer los alias, y los alias viven en los
   * tsconfig, que forman parte del mismo arbol. */
  const porRoot = normalizados.map(root => {
    const ficheros: string[] = [];
    listarFuentes(root, ficheros);
    return ficheros;
  });
  const alias = leerAliases(porRoot.flat());

  for (const ficheros of porRoot) {
    for (const fichero of ficheros) {
      if (RE_FUENTE_JS.test(fichero)) { indexarEnlaces(fichero, indice, alias); }
    }
  }
  for (const ficheros of porRoot) {
    for (const fichero of ficheros) {
      if (/\.(?:tsx|jsx)$/.test(fichero)) { indexarJsx(fichero, indice); }
      else if (fichero.endsWith('.css')) { indexarCss(fichero, indice); }
    }
  }

  cacheIndice.set(clave, indice);
  return indice;
}
