/* [108A-1 Fase 4] Bootstrap reproducible de proyecto nuevo: `sentinel init`,
 * `sentinel migrate` y `sentinel uninit`.
 *
 * `init` genera el contrato mínimo (sentinel.config.json v2 + sentinel.lock.json
 * + .sentinel/init-manifest.json) desde presets de stack agnósticos. NUNCA
 * genera, copia ni sugiere un `scripts/quality` ni submódulos de analyzers.
 * `migrate` descubre gate/scripts legacy y emite inventario, clasificación y
 * riesgos SIN borrar ni desactivar cobertura (la aplicación es F5).
 * `uninit` retira SOLO lo administrado por el init (init-manifest), nunca
 * archivos ajenos. Editor-agnóstico (check:core lo protege). */
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateSentinelConfig } from './config';

const execFileAsync = promisify(execFile);

export type StackPreset = 'node' | 'rust' | 'python' | 'mixed';

export interface DirectCommands {
  npmScripts: string[];
  npxTools: string[];
  cargoSubcommands: string[];
  tools: string[];
}

export interface PresetDefinition {
  includePatterns: string[];
  excludePatterns: string[];
  directCommands: DirectCommands;
}

/* [108A-1 Fase 4] Presets por stack SIN reglas específicas de producto: solo
 * patrones de archivo y comandos directos del stack. Los presets no declaran
 * reglas (las reglas productivas viven en el núcleo/plugins, una regla un
 * dueño). */
export const STACK_PRESETS: Record<StackPreset, PresetDefinition> = {
  node: {
    includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.css'],
    excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
    directCommands: {
      npmScripts: ['lint', 'test', 'build', 'check'],
      npxTools: ['eslint', 'tsc', 'typescript'],
      cargoSubcommands: [],
      tools: ['git'],
    },
  },
  rust: {
    includePatterns: ['**/*.rs', 'Cargo.toml', 'Cargo.lock'],
    excludePatterns: ['**/target/**', '**/.git/**'],
    directCommands: {
      npmScripts: [],
      npxTools: [],
      cargoSubcommands: ['check', 'test', 'clippy', 'fmt'],
      tools: ['git'],
    },
  },
  python: {
    includePatterns: ['**/*.py'],
    excludePatterns: ['**/__pycache__/**', '**/.venv/**', '**/.git/**'],
    directCommands: {
      npmScripts: [],
      npxTools: [],
      cargoSubcommands: [],
      tools: ['git', 'python', 'pip'],
    },
  },
  mixed: {
    includePatterns: [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.css',
      '**/*.rs', 'Cargo.toml', 'Cargo.lock', '**/*.py',
    ],
    excludePatterns: [
      '**/node_modules/**', '**/dist/**', '**/build/**', '**/target/**',
      '**/__pycache__/**', '**/.venv/**', '**/.git/**',
    ],
    directCommands: {
      npmScripts: ['lint', 'test', 'build', 'check'],
      npxTools: ['eslint', 'tsc', 'typescript'],
      cargoSubcommands: ['check', 'test', 'clippy', 'fmt'],
      tools: ['git', 'python', 'pip'],
    },
  },
};

export const PRESET_NAMES = Object.keys(STACK_PRESETS) as StackPreset[];

export interface PlanFile {
  path: string;
  action: 'create' | 'update' | 'skip';
  content?: string;
}

export interface InitPlan {
  files: PlanFile[];
  conflicts: string[];
  alias: { path: string; action: 'update' | 'skip' | 'none'; script: string } | null;
  primaryBranch: string | null;
  preset: StackPreset;
  dryRun: boolean;
}

export interface ApplyResult {
  applied: string[];
  backedUp: string[];
  rolledBack: string[];
}

export interface MigrateInventory {
  root: string;
  markers: Array<{ path: string; kind: 'policy' | 'gate-config' | 'tool-manifest' | 'adapter' | 'scripts-quality' | 'reports' | 'bench' }>;
  customScripts: Array<{ name: string; command: string }>;
  risks: string[];
}

async function gitBranch(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: projectRoot, timeout: 10_000, windowsHide: true,
    });
    const name = stdout.trim();
    return name || null;
  } catch {
    return null;
  }
}

async function readJson(filePath: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return null; }
}

function buildPolicyConfig(preset: StackPreset, primaryBranch: string): Record<string, unknown> {
  return {
    schemaVersion: 2,
    mode: 'enforce',
    project: { primaryBranch },
    guard: { directCommands: STACK_PRESETS[preset].directCommands },
    analyzers: {
      sentinel: {
        enabled: true,
        profile: preset,
        config: {
          includePatterns: STACK_PRESETS[preset].includePatterns,
          excludePatterns: STACK_PRESETS[preset].excludePatterns,
        },
      },
    },
  };
}

function buildLockConfig(analyzerVersion: string | null): Record<string, unknown> {
  /* [108A-1 Fase 4] El lock se genera desde el runtime; el commit de artifact
   * se fija con la publicación (F8). commit null queda explícito: un lock con
   * pin pendiente nunca debe editarse a mano. */
  return {
    schemaVersion: 1,
    generatedBy: `sentinel init ${analyzerVersion ?? 'unknown'}`,
    analyzers: {
      sentinel: { enabled: true, version: analyzerVersion ?? null, commit: null },
    },
  };
}

export async function planInit(options: {
  preset: StackPreset;
  projectRoot: string;
  dryRun?: boolean;
  force?: boolean;
  primaryBranch?: string;
  analyzerVersion?: string;
  withAlias?: string;
}): Promise<InitPlan> {
  const preset = STACK_PRESETS[options.preset] ? options.preset : 'mixed';
  const primaryBranch = options.primaryBranch ?? (await gitBranch(options.projectRoot));
  if (!primaryBranch) {
    throw new Error('no se pudo detectar la rama primaria; usa --primary-branch <rama> (no se asume main)');
  }
  const configPath = path.join(options.projectRoot, 'sentinel.config.json');
  const lockPath = path.join(options.projectRoot, 'sentinel.lock.json');
  const manifestPath = path.join(options.projectRoot, '.sentinel', 'init-manifest.json');

  const policyContent = `${JSON.stringify(buildPolicyConfig(preset, primaryBranch), null, 2)}\n`;
  const lockContent = `${JSON.stringify(buildLockConfig(options.analyzerVersion ?? null), null, 2)}\n`;
  const files: PlanFile[] = [];
  const conflicts: string[] = [];
  for (const [filePath, content] of [
    [configPath, policyContent],
    [lockPath, lockContent],
    [manifestPath, `${JSON.stringify({ schemaVersion: 1, adminFiles: ['sentinel.config.json', 'sentinel.lock.json', '.sentinel/init-manifest.json'] }, null, 2)}\n`],
  ] as Array<[string, string]>) {
    const exists = existsSync(filePath);
    if (exists) {
      const current = await readFile(filePath, 'utf8');
      if (current === content) {
        /* [108A-1 Fase 4] Idempotencia: contenido idéntico → skip, nunca
         * conflicto ni reescritura. */
        files.push({ path: filePath, action: 'skip', content });
      } else if (!options.force) {
        conflicts.push(path.relative(options.projectRoot, filePath).replace(/\\/g, '/'));
      } else {
        files.push({ path: filePath, action: 'update', content });
      }
    } else {
      files.push({ path: filePath, action: 'create', content });
    }
  }

  let alias: InitPlan['alias'] = null;
  if (options.withAlias) {
    const packagePath = path.join(options.projectRoot, 'package.json');
    const packageJson = await readJson(packagePath) as { scripts?: Record<string, string> } | null;
    if (!packageJson || typeof packageJson.scripts !== 'object') {
      alias = { path: 'package.json', action: 'skip', script: '' };
    } else if (packageJson.scripts[options.withAlias] !== undefined) {
      alias = { path: 'package.json', action: 'skip', script: String(packageJson.scripts[options.withAlias]) };
    } else {
      const script = 'sentinel check';
      const updated = { ...packageJson, scripts: { ...packageJson.scripts, [options.withAlias]: script } };
      files.push({ path: packagePath, action: 'update', content: `${JSON.stringify(updated, null, 2)}\n` });
      alias = { path: 'package.json', action: 'update', script };
    }
  }

  return {
    files,
    conflicts,
    alias,
    primaryBranch,
    preset,
    dryRun: Boolean(options.dryRun),
  };
}

/* Aplica el plan con backup previo por archivo existente y rollback si una
 * escritura falla a mitad. Solo toca los archivos del plan. */
export async function applyInit(plan: InitPlan, projectRoot: string): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], backedUp: [], rolledBack: [] };
  const created: string[] = [];
  const backups: Array<{ original: string; backup: string }> = [];
  try {
    for (const file of plan.files) {
      if (file.action === 'skip' || !file.content) continue;
      const relative = path.relative(projectRoot, file.path).replace(/\\/g, '/');
      if (file.action === 'update') {
        const backup = `${file.path}.bak-${Date.now()}`;
        await copyFile(file.path, backup);
        backups.push({ original: file.path, backup });
        result.backedUp.push(`${relative} -> ${path.basename(backup)}`);
      }
      await mkdir(path.dirname(file.path), { recursive: true });
      await writeFile(file.path, file.content, 'utf8');
      result.applied.push(relative);
      if (file.action === 'create') created.push(file.path);
    }
  } catch (error) {
    for (const file of created) await rm(file, { force: true }).catch(() => undefined);
    for (const item of backups.reverse()) {
      await copyFile(item.backup, item.original).catch(() => undefined);
      result.rolledBack.push(path.relative(projectRoot, item.original).replace(/\\/g, '/'));
    }
    throw error;
  }
  return result;
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

/* Valida que una política generada sea aceptada por el schema (fail-closed). */
export function assertGeneratedPolicyValid(content: string): void {
  validateSentinelConfig(JSON.parse(content));
}
