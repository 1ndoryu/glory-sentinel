/* [028A-6] artefacto del runtime: hash, copia y listado de archivos. Extraído de runtimeInstall.ts. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readVersion(sourceRoot: string): Promise<string> {
  const packageJson = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json del origen no contiene version');
  }
  return packageJson.version;
}

async function relativeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files.push(absolute);
    }
  }
  await walk(root);
  return files.sort();
}

/* [028A-6] Hash del artefacto: out/** + package.json (+ lock opcional).
 * node_modules se identifica por el lock y no se hashea. Determinista:
 * rutas ordenadas y contenido. */
export async function hashArtifact(sourceRoot: string): Promise<string> {
  const hash = createHash('sha256');
  const included: string[] = [];
  for (const name of ['package.json', 'package-lock.json']) {
    if (await exists(path.join(sourceRoot, name))) included.push(name);
  }
  const out = path.join(sourceRoot, 'out');
  if (await exists(out)) {
    const files = await relativeFiles(out);
    included.push(...files.map(file => path.relative(sourceRoot, file).replace(/\\/g, '/')));
  }
  for (const relative of included) {
    hash.update(relative);
    hash.update(await fs.readFile(path.join(sourceRoot, relative)));
  }
  return hash.digest('hex');
}

export async function copyRuntime(sourceRoot: string, destination: string, includeDependencies: boolean): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) {
    try {
      await fs.copyFile(path.join(sourceRoot, name), path.join(destination, name));
    } catch {
      /* Opcional. */
    }
  }
  const out = path.join(sourceRoot, 'out');
  if (await exists(out)) {
    await fs.cp(out, path.join(destination, 'out'), { recursive: true });
  }
  if (includeDependencies && await exists(path.join(sourceRoot, 'node_modules'))) {
    await fs.cp(path.join(sourceRoot, 'node_modules'), path.join(destination, 'node_modules'), { recursive: true });
  }
}
