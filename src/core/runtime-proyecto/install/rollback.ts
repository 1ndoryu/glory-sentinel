/* [028A-6] rollback a la versión anterior instalada. Extraído de runtimeInstall.ts. */
import path from 'node:path';
import { writeAtomic } from '../../seguridad-rutas/atomicFile';
import type { RuntimeRollbackOptions, RuntimeRollbackResult } from './tipos';
import { resolveRuntimeRoot } from './rutas';
import { hashArtifact } from './artefacto';
import { installedAtMs, listVersions } from './version';
import { readCurrent } from './puntero';

export async function rollbackRuntime(options: RuntimeRollbackOptions = {}): Promise<RuntimeRollbackResult> {
  const targetRoot = path.resolve(options.targetRoot ?? resolveRuntimeRoot());
  const dryRun = Boolean(options.dryRun);
  const active = await readCurrent(targetRoot);
  const versions = await listVersions(targetRoot);
  const target = options.version
    ?? [...versions]
      .filter(info => info.version !== active)
      .sort((a, b) => installedAtMs(b) - installedAtMs(a))
      .find(() => true)?.version
    ?? null;
  if (!target) {
    return { dryRun, targetRoot, previousVersion: active, restoredVersion: null, reason: 'no hay versión anterior conservada' };
  }
  const targetInfo = versions.find(info => info.version === target) ?? null;
  /* [SNT-10/028A-6] El rollback exige artifactSha256 real y verificado: sin
   * manifest o con hash ausente no se restaura (una versión sin verificar
   * podría ser un directorio corrupto o ajeno al runtime). El hash se
   * recalcula sobre la copia instalada y debe coincidir con el manifest. */
  if (!targetInfo?.artifactSha256) {
    return {
      dryRun,
      targetRoot,
      previousVersion: active,
      restoredVersion: null,
      reason: `la versión ${target} no declara artifactSha256 (manifest ausente o corrupto); no se restaura`,
    };
  }
  let verified = false;
  try {
    verified = await hashArtifact(path.join(targetRoot, 'versions', target)) === targetInfo.artifactSha256;
  } catch {
    verified = false;
  }
  if (!verified) {
    return {
      dryRun,
      targetRoot,
      previousVersion: active,
      restoredVersion: null,
      reason: `la versión ${target} no supera la verificación de artifactSha256; no se restaura`,
    };
  }
  if (!dryRun) {
    await writeAtomic(path.join(targetRoot, 'current.json'), `${JSON.stringify({ version: target, artifactSha256: targetInfo.artifactSha256 }, null, 2)}\n`);
  }
  return { dryRun, targetRoot, previousVersion: active, restoredVersion: target, reason: 'rollback a versión conservada y verificada' };
}
