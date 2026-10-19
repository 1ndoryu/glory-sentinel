/* [028A-6] raíces del runtime y del código fuente de Sentinel. Extraído de runtimeInstall.ts. */
import os from 'node:os';
import path from 'node:path';

export function resolveRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCALAPPDATA
    ? path.join(env.LOCALAPPDATA, 'GlorySentinel')
    : path.join(os.homedir(), '.glory-sentinel');
}

export function resolveSourceRoot(sourceRoot?: string): string {
  // Desde out/core/runtime-proyecto (o src/...) la raíz del repo está tres niveles arriba.
  return path.resolve(sourceRoot ?? path.resolve(__dirname, '../../../..'));
}
