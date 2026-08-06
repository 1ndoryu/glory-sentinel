import path from 'node:path';
import * as fs from 'node:fs/promises';

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function existingAncestor(candidate: string): Promise<string> {
  let current = path.resolve(candidate);
  while (true) {
    try {
      await fs.lstat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw new Error(`no se pudo resolver ancestor de ${candidate}`);
      current = parent;
    }
  }
}

export async function physicallyContained(root: string, candidate: string, label: string): Promise<string> {
  const rootReal = await fs.realpath(path.resolve(root));
  const resolvedCandidate = path.resolve(candidate);
  const ancestor = await existingAncestor(resolvedCandidate);
  const ancestorReal = await fs.realpath(ancestor);
  if (!isPathInside(rootReal, ancestorReal)) throw new Error(`${label}: ruta fuera del workspace o symlink/junction escape`);
  const suffix = path.relative(ancestor, resolvedCandidate);
  const physicalCandidate = path.resolve(ancestorReal, suffix);
  if (!isPathInside(rootReal, physicalCandidate)) throw new Error(`${label}: ruta fuera del workspace o symlink/junction escape`);
  return resolvedCandidate;
}

async function assertDirectorySegment(rootReal: string, candidate: string, label: string): Promise<void> {
  const stat = await fs.lstat(candidate);
  if (stat.isSymbolicLink()) throw new Error(`${label}: ruta fuera del workspace o symlink/junction escape`);
  if (!stat.isDirectory()) throw new Error(`${label}: debe ser un directorio`);
  const physical = await fs.realpath(candidate);
  if (!isPathInside(rootReal, physical)) throw new Error(`${label}: ruta fuera del workspace o symlink/junction escape`);
}

/**
 * Creates a directory without recursive mkdir following an untrusted link.
 * Each segment is checked as a regular directory before and after creation.
 */
export async function ensureContainedDirectory(root: string, candidate: string, label: string): Promise<string> {
  const rootReal = await fs.realpath(path.resolve(root));
  const resolved = path.resolve(candidate);
  if (!isPathInside(rootReal, resolved)) throw new Error(`${label}: ruta fuera del workspace o symlink/junction escape`);
  const relative = path.relative(rootReal, resolved);
  if (relative === '') return rootReal;
  let current = rootReal;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      await assertDirectorySegment(rootReal, current, label);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fs.mkdir(current);
      await assertDirectorySegment(rootReal, current, label);
    }
  }
  await physicallyContained(rootReal, resolved, label);
  return resolved;
}
