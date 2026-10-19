/* [028A-6] desinstalación de solo las entradas administradas por Sentinel. Extraído de runtimeInstall.ts. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafeRuntimePath, defaultProfilePaths, uninstallPathEntry, uninstallProfiles } from '../../shims/interceptorShims';
import type { RuntimeUninstallOptions, RuntimeUninstallResult } from './tipos';
import { resolveRuntimeRoot } from './rutas';
import { readCurrent } from './puntero';
import { installRuntime } from './instalar';

async function removeManagedDir(targetRoot: string, name: string, dryRun: boolean): Promise<boolean> {
  const dir = path.join(targetRoot, name);
  try {
    await fs.access(dir);
  } catch {
    return false;
  }
  if (!dryRun) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return true;
}

async function removeManagedFile(targetRoot: string, name: string, dryRun: boolean): Promise<boolean> {
  const file = path.join(targetRoot, name);
  try {
    await fs.access(file);
  } catch {
    return false;
  }
  if (!dryRun) {
    await fs.rm(file, { force: true });
  }
  return true;
}

/* [028A-6 Fase 5] ¿El target parece una raíz de runtime real de Sentinel?
 * Exigir un marcador antes de retirar directorios evita que un
 * --target-root erróneo (p. ej. C:\ o un directorio de proyecto) borre
 * `shims`/`bin`/`versions`/`.tmp`/`.retired` ajenos que existan por
 * casualidad. Un runtime instalado siempre tiene current.json/current.js
 * (escritos por installRuntime) o versions/. */
async function looksLikeRuntimeRoot(targetRoot: string): Promise<boolean> {
  for (const candidate of ['current.json', 'current.js']) {
    try {
      await fs.access(path.join(targetRoot, candidate));
      return true;
    } catch {
      /* Siguiente candidato. */
    }
  }
  try {
    /* Un `versions/` vacío (p. ej. carpeta de proyecto) NO cuenta como
     * runtime: se exige al menos una versión instalada (subdirectorio). */
    const entries = await fs.readdir(path.join(targetRoot, 'versions'));
    for (const entry of entries) {
      try {
        const stat = await fs.stat(path.join(targetRoot, 'versions', entry));
        if (stat.isDirectory()) return true;
      } catch {
        /* Entrada inconsistente: seguir. */
      }
    }
    return false;
  } catch {
    return false;
  }
}

/* [028A-6 Fase 5] Desinstalación de SOLO las entradas administradas por
 * Sentinel: entrada de PATH (shims + bin), marcadores de perfiles (nuevos y
 * legacy), directorio de shims interceptores y, sin --keep-runtime, también
 * bin/current.js/current.json/versions/.tmp/.retired. Nunca borra el
 * directorio raíz del runtime ni nada fuera de <targetRoot>: el contrato del
 * plan exige un comando de desinstalación que no toque entradas ajenas. Sin
 * marcador de runtime (current.json/current.js/versions) no se retira ningún
 * directorio del filesystem. Con dry-run calcula y reporta sin escribir
 * nada. Los errores de filesystem se registran en `errors` (el CLI devuelve
 * exit 1), igual que los errores de PATH/perfiles. */
export async function uninstallRuntime(options: RuntimeUninstallOptions = {}): Promise<RuntimeUninstallResult> {
  const targetRoot = assertSafeRuntimePath(options.targetRoot ?? resolveRuntimeRoot());
  const dryRun = Boolean(options.dryRun);
  const keepRuntime = Boolean(options.keepRuntime);
  const activeVersion = await readCurrent(targetRoot);
  const pathEntry = await uninstallPathEntry(targetRoot, {
    dryRun,
    ...(options.pathRead ? { read: options.pathRead } : {}),
    ...(options.pathWrite ? { write: options.pathWrite } : {}),
  });
  const profilesResult = await uninstallProfiles({
    shimDir: path.join(targetRoot, 'shims'),
    profiles: options.profiles ?? defaultProfilePaths(),
    dryRun,
  });
  const errors: string[] = [];
  const removeStep = async (action: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await action();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const isRuntimeRoot = await looksLikeRuntimeRoot(targetRoot);
  const removedCurrentJs = keepRuntime || !isRuntimeRoot ? false : await removeStep(() => removeManagedFile(targetRoot, 'current.js', dryRun));
  const removedCurrentJson = keepRuntime || !isRuntimeRoot ? false : await removeStep(() => removeManagedFile(targetRoot, 'current.json', dryRun));
  return {
    dryRun,
    targetRoot,
    activeVersion,
    keepRuntime,
    pathEntry,
    profiles: profilesResult.profiles,
    removedShimsDir: isRuntimeRoot ? await removeStep(() => removeManagedDir(targetRoot, 'shims', dryRun)) : false,
    removedBinDir: keepRuntime || !isRuntimeRoot ? false : await removeStep(() => removeManagedDir(targetRoot, 'bin', dryRun)),
    removedCurrent: removedCurrentJs || removedCurrentJson,
    removedVersions: keepRuntime || !isRuntimeRoot ? false : await removeStep(() => removeManagedDir(targetRoot, 'versions', dryRun)),
    removedTmp: keepRuntime || !isRuntimeRoot ? false : await removeStep(() => removeManagedDir(targetRoot, '.tmp', dryRun)),
    removedRetired: keepRuntime || !isRuntimeRoot ? false : await removeStep(() => removeManagedDir(targetRoot, '.retired', dryRun)),
    errors,
  };
}
