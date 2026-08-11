/* [108A-1 Fase 4] Handlers de bootstrap reproducible: `sentinel init`,
 * `sentinel migrate` y `sentinel uninit`. Viven en módulo propio (F2 SRP)
 * para mantener src/cli/commands.ts dentro del budget de tamaño del ADR 0001
 * y agrupar los comandos de ciclo de vida del contrato aparte del análisis.
 * La versión del runtime se inyecta desde el dispatch (sin ciclo de imports):
 * initCliTarget(args, analyzerVersion). */
import * as path from 'path';
import { ParsedCliArgs } from './args';
import {
  PRESET_NAMES,
  StackPreset,
  applyInit,
  applyUninit,
  discoverLegacy,
  formatInitPlan,
  formatInventory,
  formatUninitPlan,
  planInit,
  planUninit,
} from '../core/projectInit';

export interface InitCliResult {
  output: string;
  exitCode: number;
}

/* [108A-1 Fase 4] `sentinel init`: bootstrap reproducible. --dry-run emite el
 * plan sin escribir; sin --force, conflictos existentes terminan exit 1 sin
 * aplicar nada (nunca se sobrescribe un sentinel.config.json ajeno). */
export async function initCliTarget(args: ParsedCliArgs, analyzerVersion?: string): Promise<InitCliResult> {
  const projectRoot = path.resolve(args.workspacePath ?? process.cwd());
  const preset = PRESET_NAMES.includes(args.initPreset as StackPreset)
    ? (args.initPreset as StackPreset)
    : 'mixed';
  const plan = await planInit({
    preset,
    projectRoot,
    dryRun: args.dryRun,
    force: args.force,
    primaryBranch: args.initPrimaryBranch,
    analyzerVersion: args.initAnalyzerVersion ?? analyzerVersion,
    withAlias: args.initAlias,
  });
  /* --json cambia la representación, no el contrato: una inicialización
   * real sigue aplicando el plan. Antes de este punto el retorno temprano
   * hacía que `sentinel init --json` anunciara archivos creados sin escribir
   * ninguno, justo el comando que usarían automatizaciones y bootstrap. */
  if (args.dryRun || (args.json && plan.conflicts.length > 0)) {
    return {
      output: `${JSON.stringify({
        dryRun: Boolean(args.dryRun),
        preset: plan.preset,
        primaryBranch: plan.primaryBranch,
        conflicts: plan.conflicts,
        files: plan.files.map(file => ({ path: path.relative(projectRoot, file.path).replace(/\\/g, '/'), action: file.action })),
      }, null, 2)}\n`,
      exitCode: args.dryRun || plan.conflicts.length === 0 ? 0 : 1,
    };
  }
  if (plan.conflicts.length > 0) {
    return { output: `${formatInitPlan(plan)}\n`, exitCode: 1 };
  }
  const applied = await applyInit(plan, projectRoot);
  const backupText = applied.backedUp.length > 0 ? ` (backup: ${applied.backedUp.join(', ')})` : '';
  if (args.json) {
    return {
      output: `${JSON.stringify({
        dryRun: false,
        preset: plan.preset,
        primaryBranch: plan.primaryBranch,
        conflicts: plan.conflicts,
        files: plan.files.map(file => ({ path: path.relative(projectRoot, file.path).replace(/\\/g, '/'), action: file.action })),
        applied: applied.applied.map(file => path.relative(projectRoot, file).replace(/\\/g, '/')),
        backedUp: applied.backedUp.map(file => path.relative(projectRoot, file).replace(/\\/g, '/')),
      }, null, 2)}\n`,
      exitCode: 0,
    };
  }
  return {
    output: `${formatInitPlan(plan)}\n[init] aplicado: ${applied.applied.join(', ')}${backupText}\n`,
    exitCode: 0,
  };
}

/* [108A-1 Fase 4] `sentinel migrate`: SOLO descubre en F4 (inventario,
 * clasificación y riesgos); la aplicación es F5. Nunca borra ni desactiva
 * cobertura en dry-run (y aquí siempre es discovery). */
export async function migrateCliTarget(args: ParsedCliArgs): Promise<string> {
  const projectRoot = path.resolve(args.workspacePath ?? process.cwd());
  const inventory = await discoverLegacy(projectRoot);
  return args.json
    ? `${JSON.stringify(inventory, null, 2)}\n`
    : `${formatInventory(inventory)}\n`;
}

/* [108A-1 Fase 4] `sentinel uninit`: retira SOLO lo administrado por init
 * (init-manifest). Sin manifest, exit 1 (nada administrado). */
export async function uninitCliTarget(args: ParsedCliArgs): Promise<InitCliResult> {
  const projectRoot = path.resolve(args.workspacePath ?? process.cwd());
  const plan = await planUninit(projectRoot);
  if (plan.unknown) {
    return { output: `${formatUninitPlan(plan)}\n`, exitCode: 1 };
  }
  if (args.dryRun || args.json) {
    return {
      output: args.json
        ? `${JSON.stringify(plan, null, 2)}\n`
        : `${formatUninitPlan(plan)}\n`,
      exitCode: 0,
    };
  }
  const removed = await applyUninit(projectRoot);
  return { output: `[uninit] retirado: ${removed.join(', ') || 'nada'}\n`, exitCode: 0 };
}
