/* [108A-1 Fase 4] Formato de salida de `init`, `migrate` y `uninit`. Extraído de projectInit.ts. */
import path from 'node:path';
import type { InitPlan } from './plan';
import type { MigrateInventory, UninitPlan } from './migrar';

export function formatInitPlan(plan: InitPlan): string {
  const lines = [
    `[init] preset ${plan.preset} · rama ${plan.primaryBranch ?? 'n/a'} · ${plan.dryRun ? 'DRY-RUN (sin escrituras)' : 'aplicar'}`,
  ];
  for (const file of plan.files) {
    lines.push(`[init]   ${file.action.padEnd(6)} ${path.relative(process.cwd(), file.path).replace(/\\/g, '/')}`);
  }
  if (plan.alias) lines.push(`[init]   ${plan.alias.action.padEnd(6)} package.json (script ${plan.alias.script || 'ya existe'})`);
  if (plan.conflicts.length > 0) {
    lines.push(`[init] CONFLICTO: ${plan.conflicts.join(', ')} ya existen; usa --force para respaldar y sobrescribir`);
  }
  return lines.join('\n');
}

export function formatInventory(inventory: MigrateInventory): string {
  const lines = [`[migrate] inventario legacy en ${inventory.root}`];
  for (const marker of inventory.markers) {
    lines.push(`[migrate]   marker ${marker.kind.padEnd(14)} ${marker.path}`);
  }
  for (const script of inventory.customScripts) {
    lines.push(`[migrate]   script  ${script.name} = ${script.command}`);
  }
  for (const risk of inventory.risks) lines.push(`[migrate] RIESGO: ${risk}`);
  if (inventory.markers.length === 0 && inventory.customScripts.length === 0) {
    lines.push('[migrate] sin gate/scripts legacy detectados');
  }
  return lines.join('\n');
}

export function formatUninitPlan(plan: UninitPlan): string {
  if (plan.unknown) return '[uninit] sin init-manifest: nada administrado por sentinel init';
  if (plan.adminFiles.length === 0) return '[uninit] nada que retirar';
  return `[uninit] retirar solo lo administrado:\n${plan.adminFiles.map(file => `[uninit]   ${file}`).join('\n')}`;
}
