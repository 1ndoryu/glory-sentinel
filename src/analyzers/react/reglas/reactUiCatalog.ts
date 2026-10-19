/*
 * Catálogo del design system UI del workspace para las reglas React.
 * Responde si un componente canónico (Button, Input...) existe en alguna
 * raíz del workspace. Extraído de reactComponentRules.ts sin cambio de
 * comportamiento: la caché es de módulo y se vacía al reconfigurar las raíces.
 */

import * as fs from 'fs';
import * as path from 'path';

const cacheComponentesUi = new Map<string, boolean>();
let workspaceRootsReact: string[] = [];

/* Carpetas (segmentos desde cada raiz) donde vive el design system. Por defecto cubre los
 * layouts conocidos de los proyectos Glory; `rutasGlory.carpetasUi` del config las sustituye. */
const BASES_UI_REACT_POR_DEFECTO: string[][] = [
  ['frontend', 'src', 'components', 'ui'],
  ['src', 'components', 'ui'],
  ['App', 'React', 'components', 'ui'],
  ['components', 'ui'],
  /* [318A-3] PROYECTO TASKS tiene el design system en frontend/src/app/components
   * (ui/ para componentes base, shared/ para compuestos tipo Range/ToggleSwitch) */
  ['frontend', 'src', 'app', 'components', 'ui'],
  ['frontend', 'src', 'app', 'components', 'shared'],
];

let basesUiReact: string[][] = BASES_UI_REACT_POR_DEFECTO;

const claveBases = (bases: string[][]): string => bases.map(segmentos => segmentos.join('/')).join('|');

/* Lista vacia o ausente = defaults. Si cambia, la cache de existencia deja de ser valida y se vacia. */
export function configurarBasesUiReact(bases?: string[][]): void {
  const nuevas = bases && bases.length > 0 ? bases : BASES_UI_REACT_POR_DEFECTO;
  if (claveBases(nuevas) === claveBases(basesUiReact)) {
    return;
  }

  basesUiReact = nuevas;
  cacheComponentesUi.clear();
}

export function configurarWorkspaceRootsReact(roots: string[]): void {
  const normalizadas = roots.map(root => root.replace(/\\/g, '/'));
  if (normalizadas.join('|') === workspaceRootsReact.join('|')) {
    return;
  }

  workspaceRootsReact = normalizadas;
  cacheComponentesUi.clear();
}

/* [119A-4 S4] Expone las roots para que reactAnalyzer calcule
 * proyectoTieneModalCanonico() una vez por archivo. */
export function obtenerWorkspaceRootsReact(): string[] {
  return workspaceRootsReact;
}

export function existeComponenteUi(nombres: string[]): boolean {
  const cacheKey = nombres.join('|');
  const cached = cacheComponentesUi.get(cacheKey);
  if (cached !== undefined) { return cached; }

  const extensiones = ['tsx', 'ts', 'jsx', 'js'];

  for (const workspaceRoot of workspaceRootsReact) {
    for (const segmentosBase of basesUiReact) {
      for (const nombre of nombres) {
        for (const extension of extensiones) {
          const rutaArchivo = path.join(workspaceRoot, ...segmentosBase, `${nombre}.${extension}`);
          if (fs.existsSync(rutaArchivo)) {
            cacheComponentesUi.set(cacheKey, true);
            return true;
          }
        }
      }
    }
  }

  cacheComponentesUi.set(cacheKey, false);
  return false;
}
