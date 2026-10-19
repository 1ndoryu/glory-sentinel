/* [108A-1 Fase 2] Utilidades comunes a los handlers del CLI: lectura de
 * sentinel.config.json, escritura de la salida y versión del paquete.
 * readPackageVersion resuelve ../../../package.json desde este directorio
 * (src/cli/comandos o out/cli/comandos): no mover este módulo sin ajustar esa ruta. */
import * as fs from 'fs/promises';
import * as path from 'path';
import { validateSentinelConfig } from '../../core/runtime-proyecto/config';
import type { SentinelCliConfigFile } from '../parseo/argsTypes';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readConfig(configPath?: string, workspacePath?: string): Promise<SentinelCliConfigFile> {
  const candidate = configPath
    ? path.resolve(configPath)
    : path.resolve(workspacePath ?? process.cwd(), 'sentinel.config.json');

  if (!await fileExists(candidate)) {
    return {};
  }

  const raw = await fs.readFile(candidate, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  validateSentinelConfig(parsed);
  return parsed;
}

export async function readPackageVersion(): Promise<string> {
  const packagePath = path.resolve(__dirname, '../../../package.json');
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8')) as { version?: unknown };
  if (typeof packageJson.version !== 'string') {
    throw new Error('package.json no contiene una version valida');
  }
  return packageJson.version;
}

export async function writeOrPrint(output: string, outputPath?: string): Promise<void> {
  if (!outputPath) {
    process.stdout.write(output);
    return;
  }

  const resolved = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, output, 'utf8');
}
