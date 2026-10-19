/* [028A-6] orden de versiones y listado de instalaciones. Extraído de runtimeInstall.ts. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeVersionInfo } from './tipos';

/* [028A-6] Orden estable de versiones sin localeCompare: partes numéricas
 * primero, resto lexicográfico. Evita 0.10 < 0.9 y dependencia de locale. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (Number.isInteger(na) && Number.isInteger(nb)) {
      if (na !== nb) return na - nb;
    } else {
      const sa = pa[i] ?? '';
      const sb = pb[i] ?? '';
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

/* [028A-6] Timestamp de instalación para elegir la anterior; versiones sin
 * manifest se consideran las más antiguas y nunca ganan el rollback. */
export function installedAtMs(info: RuntimeVersionInfo): number {
  if (!info.installedAt) return Number.MIN_SAFE_INTEGER;
  const parsed = Date.parse(info.installedAt);
  return Number.isNaN(parsed) ? Number.MIN_SAFE_INTEGER : parsed;
}

export async function listVersions(targetRoot: string): Promise<RuntimeVersionInfo[]> {
  try {
    const entries = await fs.readdir(path.join(targetRoot, 'versions'), { withFileTypes: true });
    const infos: RuntimeVersionInfo[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let manifest: RuntimeVersionInfo | null = null;
      try {
        manifest = JSON.parse(await fs.readFile(path.join(targetRoot, 'versions', entry.name, 'manifest.json'), 'utf8')) as RuntimeVersionInfo;
      } catch {
        /* Sin manifest: metadatos mínimos. */
      }
      infos.push(manifest ?? { version: entry.name, artifactSha256: null, installedAt: null });
    }
    return infos.sort((a, b) => compareVersions(a.version, b.version));
  } catch {
    return [];
  }
}
