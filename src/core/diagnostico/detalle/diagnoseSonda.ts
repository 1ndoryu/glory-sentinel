/* Sondas de readiness de cada herramienta: lectura de JSON, versión y
 * capabilities del CLI, metadata de package.json y evidencia de release.
 * Solo lectura; si una sonda falla devuelve valores vacíos y nunca lanza. */
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function cliVersion(cliPath: string | null): Promise<string | null> {
  if (!cliPath) return null;
  try {
    const result = await execFileAsync(process.execPath, [cliPath, '--version'], {
      cwd: path.dirname(cliPath),
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    const value = result.stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function cliCapabilities(cliPath: string | null): Promise<string[]> {
  if (!cliPath) return [];
  try {
    const result = await execFileAsync(process.execPath, [cliPath, '--help'], {
      cwd: path.dirname(cliPath),
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    const text = `${result.stdout}\n${result.stderr}`;
    return ['analyze', 'check', 'guard', 'doctor', 'status', 'task', 'recover']
      .filter(capability => new RegExp(`(?:^|[\\s|])${capability}(?:\\s|$|[<|])`, 'mu').test(text));
  } catch {
    return [];
  }
}

export async function packageMetadata(sourcePath: string | null, config: Record<string, unknown> | null): Promise<{
  packagePresent: boolean;
  packageLockPresent: boolean;
  dependenciesPresent: boolean;
  requiredScripts: string[];
  missingScripts: string[];
}> {
  if (!sourcePath) return { packagePresent: false, packageLockPresent: false, dependenciesPresent: false, requiredScripts: [], missingScripts: [] };
  let packageJson: { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> } | null = null;
  try {
    packageJson = JSON.parse(await readFile(path.join(sourcePath, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  } catch {
    return { packagePresent: false, packageLockPresent: false, dependenciesPresent: false, requiredScripts: [], missingScripts: [] };
  }
  const packageLockPresent = await access(path.join(sourcePath, 'package-lock.json')).then(() => true).catch(() => false);
  const declaredDependencies = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
  const dependenciesPresent = await access(path.join(sourcePath, 'node_modules')).then(async () =>
    Promise.all(declaredDependencies.map(async dependency => {
      try { await access(path.join(sourcePath, 'node_modules', dependency)); return true; } catch { return false; }
    })).then(results => results.every(Boolean))
  ).catch(() => false);
  const requiredScripts = [config?.buildScript, config?.testScript]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const missingScripts = requiredScripts.filter(script => typeof packageJson?.scripts?.[script] !== 'string');
  return { packagePresent: true, packageLockPresent, dependenciesPresent, requiredScripts, missingScripts };
}

export async function releaseEvidence(root: string, name: string, commit: string | null, configuredTestScript: string | null): Promise<boolean> {
  if (!commit) return false;
  const evidence = await readJsonFile(path.join(root, '.sentinel', 'release-evidence', `${name}.json`));
  return Boolean(evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    && (evidence as Record<string, unknown>).commit === commit
    && (evidence as Record<string, unknown>).compile === 'passed'
    && (evidence as Record<string, unknown>).suite === (configuredTestScript ? 'passed' : 'not-configured')
    && (evidence as Record<string, unknown>).cleanStaging === true);
}
