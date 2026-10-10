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

  const basesRelativas = [
    path.join('frontend', 'src', 'components', 'ui'),
    path.join('src', 'components', 'ui'),
    path.join('App', 'React', 'components', 'ui'),
    path.join('components', 'ui'),
    /* [318A-3] PROYECTO TASKS tiene el design system en frontend/src/app/components
     * (ui/ para componentes base, shared/ para compuestos tipo Range/ToggleSwitch) */
    path.join('frontend', 'src', 'app', 'components', 'ui'),
    path.join('frontend', 'src', 'app', 'components', 'shared'),
  ];
  const extensiones = ['tsx', 'ts', 'jsx', 'js'];

  for (const workspaceRoot of workspaceRootsReact) {
    for (const baseRelativa of basesRelativas) {
      for (const nombre of nombres) {
        for (const extension of extensiones) {
          const rutaArchivo = path.join(workspaceRoot, baseRelativa, `${nombre}.${extension}`);
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
