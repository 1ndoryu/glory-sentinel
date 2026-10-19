/* [108A-1 Fase 4] Plan y aplicación de `sentinel init` con backup previo por archivo y rollback. Extraído de projectInit.ts. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { StackPreset } from './presets';
import { STACK_PRESETS, buildLockConfig, buildPolicyConfig } from './presets';

const execFileAsync = promisify(execFile);

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

export async function readJson(filePath: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return null; }
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
