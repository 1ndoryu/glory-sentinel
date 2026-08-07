import * as fs from 'fs/promises';
import * as path from 'path';

export async function canonicalPath(target: string): Promise<string> {
  let candidate = path.resolve(target);
  const missing: string[] = [];
  while (true) {
    try {
      const existing = await fs.realpath(candidate);
      return path.resolve(existing, ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      missing.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

export function isStrictlyInside(candidate: string, boundary: string): boolean {
  const relative = path.relative(boundary, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.\//u, '');
}
