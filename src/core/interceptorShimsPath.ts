import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { assertSafeRuntimePath } from './interceptorShimsBase';

/* [028A-6 Fase 3] Gestión del PATH de usuario para los shims del runtime.
 * El runtime es autónomo: instala el runtime, genera los shims, dot-sourcea
 * los perfiles (--with-profiles) y puede exponer <target>/shims en el PATH
 * de usuario (--with-path) sin conocer repositorios concretos. La lectura y
 * escritura del PATH de usuario son inyectables para tests; la implementación
 * real usa PowerShell ([Environment]::...User), igual que el instalador
 * legacy del repo. Fuera de Windows devuelve 'unsupported' (la matriz
 * multi-shell es Fase 4). */

const execFileAsync = promisify(execFile);

export function shimsPathFor(targetRoot: string): string {
  return path.join(assertSafeRuntimePath(targetRoot), 'shims');
}

/* [028A-6 Fase 3] Directorios del runtime que se exponen en el PATH de
 * usuario: <target>/shims (interceptores npm/npx/cargo/node) y <target>/bin
 * (el CLI `sentinel`). Ambos son administrados por el runtime. */
export function runtimePathEntries(targetRoot: string): string[] {
  const resolved = assertSafeRuntimePath(targetRoot);
  return [path.join(resolved, 'shims'), path.join(resolved, 'bin')];
}

export interface PathEntryOptions {
  dryRun?: boolean;
  read?: () => Promise<string | null>;
  write?: (value: string) => Promise<void>;
}

export interface PathEntryResult {
  action: 'added' | 'removed' | 'unchanged' | 'unsupported' | 'error';
  path: string;
  /** Próximo valor del PATH (solo dry-run). */
  next?: string;
  error?: string;
}

async function defaultReadUserPath(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"],
      { windowsHide: true, timeout: 8000 },
    );
    const value = String(stdout).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function defaultWriteUserPath(value: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const safe = value.replace(/'/gu, "''");
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `[Environment]::SetEnvironmentVariable('Path', '${safe}', 'User')`],
    { windowsHide: true, timeout: 8000 },
  );
}

function pathEntriesEqual(left: string, right: string): boolean {
  const compare = process.platform === 'win32' ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase() : (a: string, b: string) => a === b;
  return compare(left.replace(/\\/gu, '/').replace(/\/$/u, ''), right.replace(/\\/gu, '/').replace(/\/$/u, ''));
}

/* [028A-6 Fase 3] Asegura que los directorios administrados del runtime
 * (shims + bin) estén al principio del PATH de usuario (Windows).
 * Idempotente: si ya están, 'unchanged'. Con dry-run solo calcula y devuelve
 * el próximo valor. 'unsupported' cuando no hay PATH de usuario
 * administrable en la plataforma o la lectura falla. */
export async function installPathEntry(targetRoot: string, options: PathEntryOptions = {}): Promise<PathEntryResult> {
  const managed = runtimePathEntries(targetRoot);
  const label = managed.join('; ');
  const read = options.read ?? defaultReadUserPath;
  const write = options.write ?? defaultWriteUserPath;
  try {
    const current = await read();
    if (current === null) return { action: 'unsupported', path: label };
    const existing = current.split(';').map(value => value.trim()).filter(Boolean);
    const missing = managed.filter(entry => !existing.some(value => pathEntriesEqual(value, entry)));
    if (missing.length === 0) return { action: 'unchanged', path: label };
    const withoutManaged = existing.filter(value => !managed.some(entry => pathEntriesEqual(value, entry)));
    const next = [...managed, ...withoutManaged].join(';');
    if (options.dryRun) return { action: 'added', path: label, next };
    await write(next);
    return { action: 'added', path: label };
  } catch (error) {
    return { action: 'error', path: label, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function uninstallPathEntry(targetRoot: string, options: PathEntryOptions = {}): Promise<PathEntryResult> {
  const managed = runtimePathEntries(targetRoot);
  const label = managed.join('; ');
  const read = options.read ?? defaultReadUserPath;
  const write = options.write ?? defaultWriteUserPath;
  try {
    const current = await read();
    if (current === null) return { action: 'unsupported', path: label };
    const existing = current.split(';').map(value => value.trim()).filter(Boolean);
    const next = existing.filter(value => !managed.some(entry => pathEntriesEqual(value, entry))).join(';');
    if (next === current) return { action: 'unchanged', path: label };
    if (options.dryRun) return { action: 'removed', path: label, next };
    await write(next);
    return { action: 'removed', path: label };
  } catch (error) {
    return { action: 'error', path: label, error: error instanceof Error ? error.message : String(error) };
  }
}

export function formatPathEntryResult(result: PathEntryResult): string {
  const prefix = result.action === 'error' ? 'ERROR' : result.action.toUpperCase();
  const suffix = result.error ? ` (${result.error})` : result.next ? ` → ${result.next}` : '';
  return `[path] ${prefix} ${result.path}${suffix}`;
}
