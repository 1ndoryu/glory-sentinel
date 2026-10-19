/* [108A-1 Fase 4] Bootstrap reproducible de proyecto nuevo: `sentinel init`,
 * `sentinel migrate` y `sentinel uninit`.
 *
 * `init` genera el contrato mínimo (sentinel.config.json v2 + sentinel.lock.json
 * + .sentinel/init-manifest.json) desde presets de stack agnósticos. NUNCA
 * genera, copia ni sugiere un `scripts/quality` ni submódulos de analyzers.
 * `migrate` descubre gate/scripts legacy y emite inventario, clasificación y
 * riesgos SIN borrar ni desactivar cobertura (la aplicación es F5).
 * `uninit` retira SOLO lo administrado por el init (init-manifest), nunca
 * archivos ajenos. Editor-agnóstico (check:core lo protege).
 * Fachada: la lógica vive en init/; este archivo conserva la API pública
 * (mismos exports y mismo path). */

export type { StackPreset, DirectCommands, PresetDefinition } from './init/presets';
export { STACK_PRESETS, PRESET_NAMES, assertGeneratedPolicyValid } from './init/presets';
export type { PlanFile, InitPlan, ApplyResult } from './init/plan';
export { planInit, applyInit } from './init/plan';
export type { MigrateInventory, UninitPlan } from './init/migrar';
export { discoverLegacy, planUninit, applyUninit } from './init/migrar';
export { formatInitPlan, formatInventory, formatUninitPlan } from './init/formato';
