/* [VISIBLE-WORKTREE] Contrato de entorno de tareas: manifiesto de entradas
 * necesarias ademas del contenido versionado, provision reproducibles dentro
 * del worktree y fallo claro (missing-task-input) cuando falta una dependencia.
 * Las categorias siguen el contrato documentado: tracked, generated,
 * ignored-local, external y secret. */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { canonicalPath, isStrictlyInside } from './pathSafety';

export const ENV_MANIFEST_SCHEMA_VERSION = 1;
export const DEFAULT_ENV_MANIFEST = 'sentinel.env-manifest.json';

export const ENV_INPUT_CATEGORIES = ['tracked', 'generated', 'ignored-local', 'external', 'secret'] as const;
export type EnvInputCategory = (typeof ENV_INPUT_CATEGORIES)[number];

export interface EnvInput {
  /** Ruta dentro del worktree de la tarea. */
  path: string;
  category: EnvInputCategory;
  /** Fuente declarada para ignored-local (relativa al projectRoot). */
  source?: string;
  /** Solo ignored-local puede autorizar edición parcial de esta ruta. */
  editable?: boolean;
}

export interface EnvManifest {
  schemaVersion: number;
  inputs: EnvInput[];
}

export interface MissingTaskInput {
  path: string;
  category: EnvInputCategory;
  source: string | null;
  action: string;
}

export class MissingTaskInputError extends Error {
  constructor(public readonly missing: MissingTaskInput[]) {
    super(
      `missing-task-input: ${missing
        .map(
          item =>
            `${item.path} (categoría ${item.category}; origen esperado: ${item.source ?? 'n/d'}; acción requerida: ${item.action})`,
        )
        .join('; ')}`,
    );
    this.name = 'MissingTaskInputError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function relativeSafePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) {
    throw new Error(`${label} debe ser una ruta relativa`);
  }
  const normalized = value.replace(/\\/gu, '/');
  if (normalized.split('/').includes('..')) throw new Error(`${label} no puede contener '..'`);
  return value;
}

export function parseEnvManifest(text: string): EnvManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`sentinel.env-manifest.json no es JSON válido: ${(error as Error).message}`);
  }
  if (!isPlainObject(raw) || raw.schemaVersion !== ENV_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`sentinel.env-manifest.json debe declarar schemaVersion ${ENV_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(raw.inputs)) throw new Error('sentinel.env-manifest.json.inputs debe ser un arreglo');
  const inputs: EnvInput[] = raw.inputs.map((entry, index) => {
    if (!isPlainObject(entry)) throw new Error(`inputs[${index}] debe ser un objeto`);
    const category = entry.category;
    if (typeof category !== 'string' || !(ENV_INPUT_CATEGORIES as readonly string[]).includes(category)) {
      throw new Error(`inputs[${index}].category inválido: ${String(category)}`);
    }
    const input: EnvInput = {
      path: relativeSafePath(entry.path, `inputs[${index}].path`),
      category: category as EnvInputCategory,
    };
    if (entry.source !== undefined) {
      input.source = relativeSafePath(entry.source, `inputs[${index}].source`);
    }
    if (category === 'ignored-local' && input.source === undefined) {
      throw new Error(`inputs[${index}]: ignored-local requiere source declarado`);
    }
    if (entry.editable !== undefined && typeof entry.editable !== 'boolean') {
      throw new Error(`inputs[${index}].editable debe ser booleano`);
    }
    input.editable = entry.editable === true;
    if (input.editable && category !== 'ignored-local') {
      throw new Error(`inputs[${index}]: editable solo se permite para ignored-local`);
    }
    if (category === 'secret' && input.source !== undefined) {
      throw new Error(`inputs[${index}]: secret no puede venir de un source del checkout; debe entrar por secret store/env`);
    }
    return input;
  });
  return { schemaVersion: ENV_MANIFEST_SCHEMA_VERSION, inputs };
}

/** Resuelve la ruta del manifiesto: la explícita (debe existir) o el default.
 * Devuelve null si no hay manifiesto (comportamiento previo intacto). */
export async function resolveEnvManifestPath(projectRoot: string, explicit?: string): Promise<string | null> {
  const canonicalProject = await canonicalPath(projectRoot);
  const candidate = explicit !== undefined && explicit !== ''
    ? path.resolve(projectRoot, explicit)
    : path.join(projectRoot, DEFAULT_ENV_MANIFEST);
  const canonicalCandidate = await canonicalPath(candidate);
  if (!isStrictlyInside(canonicalCandidate, canonicalProject)) {
    throw new Error(`el manifiesto de entorno debe permanecer dentro del projectRoot: ${candidate}`);
  }
  try {
    await readFile(candidate, 'utf8');
    return candidate;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (explicit !== undefined && explicit !== '') {
        throw new Error(`manifiesto de entorno no encontrado: ${candidate}`);
      }
      return null;
    }
    throw error;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await readFile(target);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : true;
  }
}

/** Comprueba si una ruta dentro del worktree está versionada (tracked). */
async function runGit(worktree: string, args: string[]): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const result = await execFileAsync('git', args, { cwd: worktree, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout;
}

async function ignoredPaths(worktree: string): Promise<string[]> {
  const output = await runGit(worktree, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']);
  return output
    .split('\0')
    .map(item => item.replace(/\\/gu, '/'))
    .filter(Boolean);
}

async function assertPhysicalPathInside(target: string, worktree: string, label: string): Promise<void> {
  const canonicalTarget = await canonicalPath(target);
  const canonicalWorktree = await canonicalPath(worktree);
  if (!isStrictlyInside(canonicalTarget, canonicalWorktree)) {
    throw new Error(`${label} fuera del worktree: ${target}`);
  }
}

/** Comprueba si una ruta dentro del worktree está versionada (tracked). */
async function isTracked(worktree: string, relative: string): Promise<boolean> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync('git', ['-C', worktree, 'ls-files', '--error-unmatch', '--', relative], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export interface IgnoredInputSnapshot {
  path: string;
  sha256: string;
  editable: boolean;
}

export interface IgnoredBaselineSnapshot {
  path: string;
  sha256: string;
}

export interface ProvisionResult {
  provisioned: string[];
  missing: MissingTaskInput[];
  ignoredInputs: IgnoredInputSnapshot[];
  ignoredBaseline: IgnoredBaselineSnapshot[];
}

/** Provisiona las entradas declaradas dentro del worktree. Solo copia
 * ignored-local desde su fuente declarada (copia explícita aprobada); las
 * demás categorías se verifican o se registran sin copiar. */
export async function provisionTaskInputs(
  projectRoot: string,
  worktree: string,
  manifestPath: string,
): Promise<ProvisionResult> {
  const manifest = parseEnvManifest(await readFile(manifestPath, 'utf8'));
  const canonicalProject = await canonicalPath(projectRoot);
  const canonicalWorktree = await canonicalPath(worktree);
  const provisioned: string[] = [];
  const missing: MissingTaskInput[] = [];

  const ignoredInputs: IgnoredInputSnapshot[] = [];
  const ignoredBaseline: IgnoredBaselineSnapshot[] = [];
  for (const ignoredPath of await ignoredPaths(worktree)) {
    const ignoredFile = path.resolve(worktree, ignoredPath);
    try {
      await assertPhysicalPathInside(ignoredFile, worktree, 'ignored-input preexistente');
      ignoredBaseline.push({
        path: ignoredPath,
        sha256: createHash('sha256').update(await readFile(ignoredFile)).digest('hex'),
      });
    } catch {
      /* Git can report an ignored directory in some versions/configurations;
       * only file snapshots participate in mutation validation. */
    }
  }

  for (const input of manifest.inputs) {
    const dest = path.resolve(worktree, input.path);
    const canonicalDest = await canonicalPath(dest);
    if (!isStrictlyInside(canonicalDest, canonicalWorktree)) {
      throw new Error(`entrada ${input.path}: el destino debe permanecer dentro del worktree ${worktree}`);
    }
    const destExists = await exists(dest);
    if (destExists && !(await isTracked(worktree, input.path))) {
      /* Ya existe como archivo ignorado/local dentro del worktree: la provisión
       * es autoritativa y lo reemplaza (visibilidad controlada). */
    }
    if (destExists && (await isTracked(worktree, input.path))) {
      throw new Error(`entrada ${input.path}: el destino está versionado en el worktree; el manifiesto no puede pisar contenido tracked`);
    }

    switch (input.category) {
      case 'tracked': {
        if (!destExists) {
          missing.push({
            path: input.path,
            category: input.category,
            source: null,
            action: 'verificar la base/rama: el archivo debe estar versionado en el worktree',
          });
        }
        break;
      }
      case 'generated':
      case 'external': {
        /* Se generan dentro del worktree o viven fuera del checkout: no se
         * copian; la tarea los produce o los declara por su propio medio. */
        break;
      }
      case 'ignored-local': {
        const sourcePath = path.resolve(projectRoot, input.source as string);
        const canonicalSource = await canonicalPath(sourcePath);
        if (canonicalSource === canonicalProject) {
          throw new Error(`entrada ${input.path}: la fuente ${input.source} no puede ser el projectRoot`);
        }
        if (!isStrictlyInside(canonicalSource, canonicalProject)) {
          throw new Error(`entrada ${input.path}: la fuente ${input.source} debe permanecer dentro del projectRoot`);
        }
        try {
          await readFile(sourcePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            missing.push({
              path: input.path,
              category: input.category,
              source: input.source ?? null,
              action: `crear/declarar la fuente ${input.source} en el checkout antes de task start (copia explícita aprobada)`,
            });
            continue;
          }
          throw error;
        }
        const sourceStat = await stat(sourcePath);
        if (!sourceStat.isFile()) {
          throw new Error(`entrada ${input.path}: solo se admiten fuentes de archivo para ignored-local`);
        }
        await mkdir(path.dirname(dest), { recursive: true });
        await cp(sourcePath, dest);
        const sha256 = createHash('sha256').update(await readFile(dest)).digest('hex');
        ignoredInputs.push({ path: input.path, sha256, editable: input.editable === true });
        provisioned.push(input.path);
        break;
      }
      case 'secret': {
        /* No se copia; debe entrar por secret store/env. Solo se registra. */
        break;
      }
    }
  }

  return { provisioned, missing, ignoredInputs, ignoredBaseline };
}

export async function validateIgnoredInputs(
  worktree: string,
  ignoredInputs: IgnoredInputSnapshot[],
  ignoredBaseline: IgnoredBaselineSnapshot[] = [],
): Promise<void> {
  const authorized = new Set(ignoredInputs.map(item => item.path.replace(/\\/gu, '/')));
  const baseline = new Set(ignoredBaseline.map(item => item.path.replace(/\\/gu, '/')));
  const current = await ignoredPaths(worktree);
  const unauthorized = current.filter(item => !baseline.has(item) && !authorized.has(item));
  if (unauthorized.length > 0) {
    throw new Error(`ignored-input no autorizado para la tarea: ${unauthorized.join(', ')}`);
  }

  for (const baselineInput of ignoredBaseline) {
    if (authorized.has(baselineInput.path.replace(/\\/gu, '/'))) continue;
    const baselinePath = path.resolve(worktree, baselineInput.path);
    await assertPhysicalPathInside(baselinePath, worktree, 'ignored-input preexistente');
    let currentHash: string;
    try {
      currentHash = createHash('sha256').update(await readFile(baselinePath)).digest('hex');
    } catch {
      throw new Error(`ignored-input preexistente eliminado sin autorización: ${baselineInput.path}`);
    }
    if (currentHash !== baselineInput.sha256) {
      throw new Error(`ignored-input preexistente modificado sin autorización: ${baselineInput.path}`);
    }
  }

  for (const input of ignoredInputs) {
    const dest = path.resolve(worktree, input.path);
    await assertPhysicalPathInside(dest, worktree, 'ignored-input');
    let current: string;
    try {
      current = createHash('sha256').update(await readFile(dest)).digest('hex');
    } catch {
      throw new Error(`ignored-input faltante durante validación: ${input.path}`);
    }
    if (current !== input.sha256 && !input.editable) {
      throw new Error(`ignored-input no autorizado para edición: ${input.path}`);
    }
  }
}
