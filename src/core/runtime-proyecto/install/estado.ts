/* [028A-6] estado del runtime y formato de resultados. Extraído de runtimeInstall.ts. */
import path from 'node:path';
import type { RuntimeInstallResult, RuntimeRollbackResult, RuntimeStatusResult, RuntimeUninstallResult } from './tipos';
import { resolveRuntimeRoot, resolveSourceRoot } from './rutas';
import { readVersion, hashArtifact } from './artefacto';
import { listVersions } from './version';
import { readCurrent } from './puntero';

export async function runtimeStatus(options: { targetRoot?: string } = {}): Promise<RuntimeStatusResult> {
  const targetRoot = path.resolve(options.targetRoot ?? resolveRuntimeRoot());
  const versions = await listVersions(targetRoot);
  const activeVersion = await readCurrent(targetRoot);
  const activeInfo = versions.find(info => info.version === activeVersion) ?? null;
  let sourceVersion: string | null = null;
  try {
    sourceVersion = await readVersion(resolveSourceRoot());
  } catch {
    /* Fuente sin package.json. */
  }
  let activeHash: string | null = null;
  let activeVerified = false;
  if (activeVersion && activeInfo?.artifactSha256) {
    try {
      activeHash = await hashArtifact(path.join(targetRoot, 'versions', activeVersion));
      activeVerified = activeHash === activeInfo.artifactSha256;
    } catch {
      /* Runtime no verificable. */
    }
  }
  return { targetRoot, versions, activeVersion, activeHash, activeVerified, sourceVersion };
}

export function formatRuntimeResult(result: RuntimeInstallResult | RuntimeRollbackResult | RuntimeUninstallResult): string {
  const lines: string[] = [];
  if (result.dryRun) lines.push('[dry-run] no se escribió nada');
  lines.push(`Target: ${result.targetRoot}`);
  if ('version' in result) {
    lines.push(`Versión: ${result.version}`);
    lines.push(`Artefacto: ${result.artifactSha256 ? `${result.artifactSha256.slice(0, 16)}…` : 'no hashado (dry-run)'}`);
    lines.push(`Instalado en: ${result.installed}`);
    lines.push(`Versión anterior: ${result.previousVersion ?? 'ninguna'}`);
    lines.push(`Current cambiado: ${result.changedCurrent ? 'sí' : 'no'}`);
    if (result.shims.length > 0) lines.push(`Shims: ${result.shims.join(', ')}`);
  } else if ('removedVersions' in result) {
    lines.push(`Versión activa: ${result.activeVersion ?? 'ninguna'}`);
    lines.push(`PATH: ${result.pathEntry.action}`);
    lines.push(`Perfiles: ${result.profiles.length} (${result.profiles.filter(profile => profile.action === 'removed').length} retirados)`);
    if (result.keepRuntime) lines.push('Runtime conservado: sí (--keep-runtime)');
    else {
      lines.push(`Shims: ${result.removedShimsDir ? 'retirados' : 'ausentes'}`);
      lines.push(`Bin/current: ${result.removedBinDir || result.removedCurrent ? 'retirados' : 'ausentes'}`);
      lines.push(`Versiones: ${result.removedVersions ? 'retiradas' : 'ausentes'}`);
    }
    for (const error of result.errors) lines.push(`ERROR: ${error}`);
  } else {
    lines.push(`Anterior: ${result.previousVersion ?? 'ninguna'}`);
    lines.push(`Restaurada: ${result.restoredVersion ?? 'ninguna'}${result.reason ? ` (${result.reason})` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}
