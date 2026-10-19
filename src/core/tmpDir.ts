/* Carpeta base de temporales del producto y de sus tests. Por defecto C:/tmp en
 * Windows (convención del área, AGENTS §0.2) y os.tmpdir() en el resto. Un
 * entorno puede sustituirla con SENTINEL_TMP_DIR sin tocar código. */
import os from 'node:os';

export function tmpBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SENTINEL_TMP_DIR) return env.SENTINEL_TMP_DIR;
  return process.platform === 'win32' ? 'C:/tmp' : os.tmpdir();
}
