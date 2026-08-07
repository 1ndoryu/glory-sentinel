/* [VISIBLE-WORKTREE] Contrato de entorno de tareas: manifiesto de entradas
 * necesarias ademas del contenido versionado, provision reproducibles dentro
 * del worktree y fallo claro (missing-task-input) cuando falta una dependencia.
 * Las categorias siguen el contrato documentado: tracked, generated,
 * ignored-local, external y secret. */
import { cp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalPath, isStrictlyInside } from './taskCoordinator';

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
  if (explicit !== undefined && explicit !== '') {
    const absolute = path.resolve(projectRoot, explicit);
    try {
      await readFile(absolute, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`manifiesto de entorno no encontrado: ${absolute}`);
      }
      throw error;
    }
    return absolute;
  }
  const defaultPath = path.join(projectRoot, DEFAULT_ENV_MANIFEST);
  try {
    await readFile(defaultPath, 'utf8');
    return defaultPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
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

export interface ProvisionResult {
  provisioned: string[];
  missing: MissingTaskInput[];
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
        await mkdir(path.dirname(dest), { recursive: true });
        await cp(sourcePath, dest, { recursive: true });
        provisioned.push(input.path);
        break;
      }
      case 'secret': {
        /* No se copia; debe entrar por secret store/env. Solo se registra. */
        break;
      }
    }
  }

  return { provisioned, missing };
}
