/* [028A-6] instalación de una versión del runtime. Extraído de runtimeInstall.ts. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from '../../seguridad-rutas/atomicFile';
import type { RuntimeInstallOptions, RuntimeInstallResult } from './tipos';
import { resolveRuntimeRoot, resolveSourceRoot } from './rutas';
import { exists, readVersion, hashArtifact, copyRuntime } from './artefacto';
import { readCurrentPointer, writeVersionManifest, writeCliShims } from './puntero';

export async function installRuntime(options: RuntimeInstallOptions = {}): Promise<RuntimeInstallResult> {
  const targetRoot = path.resolve(options.targetRoot ?? resolveRuntimeRoot());
  const sourceRoot = resolveSourceRoot(options.sourceRoot);
  const version = options.version ?? await readVersion(sourceRoot);
  const dryRun = Boolean(options.dryRun);
  const includeDependencies = options.includeDependencies ?? true;

  const staged = path.join(targetRoot, '.tmp', version);
  const installed = path.join(targetRoot, 'versions', version);
  const previousPointer = await readCurrentPointer(targetRoot);
  const previousVersion = previousPointer.version;

  /* [028A-6] Flujo no destructivo: el hash se calcula ANTES de escribir el
   * manifest (no se contamina a sí mismo), el staging se limpia por
   * operación (un crash previo no mezcla residuos en el hash) y la versión
   * existente se aparta a .retired/ en vez de borrarse antes del switch
   * (ventana de pérdida cero: un crash entre renames deja current.json
   * apuntando a una versión que sigue existiendo). */
  let artifactSha256 = '';
  let changedCurrent = false;
  const shims: string[] = [];
  if (!dryRun) {
    await fs.mkdir(path.dirname(installed), { recursive: true });
    await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(staged, { recursive: true });
    await copyRuntime(sourceRoot, staged, includeDependencies);
    artifactSha256 = await hashArtifact(staged);
    await writeVersionManifest(staged, version, artifactSha256);
    if (await exists(installed)) {
      const retired = path.join(targetRoot, '.retired', `${version}-${Date.now()}`);
      await fs.mkdir(path.dirname(retired), { recursive: true });
      await fs.rename(installed, retired);
      await fs.rename(staged, installed);
      await fs.rm(retired, { recursive: true, force: true }).catch(() => {});
      /* [028A-6] Limpieza del padre .retired/ cuando queda vacío. */
      await fs.rmdir(path.dirname(retired)).catch(() => {});
    } else {
      await fs.rename(staged, installed);
    }
    /* [10AA-2] Reinstalar la misma versión con otro artefacto dejaba el hash
     * antiguo en current.json: se reescribe también si cambia el sha. */
    if (previousVersion !== version || previousPointer.artifactSha256 !== artifactSha256) {
      await writeAtomic(path.join(targetRoot, 'current.json'), `${JSON.stringify({ version, artifactSha256 }, null, 2)}\n`);
      changedCurrent = true;
    }
    shims.push(...await writeCliShims(targetRoot));
  }
  return {
    dryRun,
    targetRoot,
    version,
    staged,
    installed,
    artifactSha256,
    previousVersion,
    changedCurrent,
    shims,
  };
}
