/*
 * Catálogo del design system UI del workspace para las reglas React.
 * Responde si un componente canónico (Button, Input...) existe en alguna
 * raíz del workspace. Cada análisis crea el suyo con sus raíces y carpetas:
 * sin estado de módulo, dos análisis no se pisan la configuración ni la caché [M-S13].
 */

import * as fs from 'fs';
import * as path from 'path';

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

const EXTENSIONES_UI = ['tsx', 'ts', 'jsx', 'js'];

export interface CatalogoUiReact {
  /* Raíces normalizadas (barras '/'); las usan también los análisis de modal. */
  roots: string[];
  existe(nombres: string[]): boolean;
}

/* Sin raíces, nada existe (la regla no flaggea). Bases vacías o ausentes = defaults. */
export function crearCatalogoUiReact(roots: string[], bases?: string[][]): CatalogoUiReact {
  const raices = roots.map(root => root.replace(/\\/g, '/'));
  const carpetas = bases && bases.length > 0 ? bases : BASES_UI_REACT_POR_DEFECTO;
  /* Caché propia del catálogo: vive lo que dura el análisis que lo creó. */
  const cache = new Map<string, boolean>();

  return {
    roots: raices,
    existe(nombres: string[]): boolean {
      const clave = nombres.join('|');
      const cached = cache.get(clave);
      if (cached !== undefined) { return cached; }

      const encontrado = buscarComponenteUi(raices, carpetas, nombres);
      cache.set(clave, encontrado);
      return encontrado;
    },
  };
}

function buscarComponenteUi(raices: string[], carpetas: string[][], nombres: string[]): boolean {
  for (const raiz of raices) {
    for (const segmentos of carpetas) {
      for (const nombre of nombres) {
        for (const extension of EXTENSIONES_UI) {
          if (fs.existsSync(path.join(raiz, ...segmentos, `${nombre}.${extension}`))) { return true; }
        }
      }
    }
  }
  return false;
}
