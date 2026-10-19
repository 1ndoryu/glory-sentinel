/* [108A-1 Fase 4] Descubrimiento legacy (`migrate`) y retirada administrada (`uninit`). Extraído de projectInit.ts. */
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readJson } from './plan';

export interface MigrateInventory {
  root: string;
  markers: Array<{ path: string; kind: 'policy' | 'gate-config' | 'tool-manifest' | 'adapter' | 'scripts-quality' | 'reports' | 'bench' }>;
  customScripts: Array<{ name: string; command: string }>;
  risks: string[];
}

/* [108A-1 Fase 4] migrate SOLO descubre (no muta en F4): inventario de
 * markers legacy, scripts personalizados y riesgos; la aplicación/migración
 * real es F5. */
export async function discoverLegacy(projectRoot: string): Promise<MigrateInventory> {
  const markers: MigrateInventory['markers'] = [];
  const add = (relative: string, kind: MigrateInventory['markers'][number]['kind']) => {
    if (existsSync(path.join(projectRoot, relative))) markers.push({ path: relative, kind });
  };
  add('sentinel.config.json', 'policy');
  add('quality.config.json', 'gate-config');
  add('quality-tools.json', 'tool-manifest');
  add('quality-adapter.json', 'adapter');
  add('scripts/quality', 'scripts-quality');
  add('.quality-reports', 'reports');
  add('.quality-bench', 'bench');

  const customScripts: Array<{ name: string; command: string }> = [];
  const packageJson = await readJson(path.join(projectRoot, 'package.json')) as { scripts?: Record<string, string> } | null;
  if (packageJson && typeof packageJson.scripts === 'object') {
    for (const [name, command] of Object.entries(packageJson.scripts)) {
      if (/^(task:check|quality:|check:)/u.test(name) || /sentinel\s+(check|task)/u.test(command)) {
        customScripts.push({ name, command });
      }
    }
  }

  const risks: string[] = [];
  if (markers.some(marker => marker.kind === 'scripts-quality')) {
    risks.push('scripts/quality contiene lógica de gate propia: migrar a sentinel check sin borrar hasta paridad (F5)');
  }
  if (customScripts.length > 0) {
    risks.push(`scripts personalizados detectados (${customScripts.length}): clasificar con la tabla de ownership, nunca borrarlos en dry-run`);
  }
  if (markers.some(marker => marker.kind === 'reports' || marker.kind === 'bench')) {
    risks.push('hay reportes/benchmarks legacy: regenerarlos con el gate oficial tras la migración');
  }
  return { root: projectRoot, markers, customScripts, risks };
}

export interface UninitPlan {
  adminFiles: string[];
  unknown: boolean;
}

export async function planUninit(projectRoot: string): Promise<UninitPlan> {
  const manifest = await readJson(path.join(projectRoot, '.sentinel', 'init-manifest.json')) as { adminFiles?: unknown } | null;
  if (!manifest || !Array.isArray(manifest.adminFiles)) {
    return { adminFiles: [], unknown: true };
  }
  return { adminFiles: manifest.adminFiles.filter((file): file is string => typeof file === 'string'), unknown: false };
}

/* Retira SOLO los archivos del init-manifest que existan; nunca toca otros. */
export async function applyUninit(projectRoot: string): Promise<string[]> {
  const plan = await planUninit(projectRoot);
  if (plan.unknown) throw new Error('uninit: no hay init-manifest (nada administrado por sentinel init)');
  const removed: string[] = [];
  for (const relative of plan.adminFiles) {
    const full = path.resolve(projectRoot, relative);
    if (!full.startsWith(path.resolve(projectRoot) + path.sep)) continue; // containment
    if (existsSync(full)) {
      await rm(full, { recursive: true, force: true });
      removed.push(relative);
    }
  }
  return removed;
}
