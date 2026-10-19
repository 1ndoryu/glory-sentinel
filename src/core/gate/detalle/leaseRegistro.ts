/* [028A-6] Almacén de leases en el guard root: directorio "leases", auditoría
 * append-only, listado, poda de expirados, revocación y salida para la CLI. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { resolveGuardRoot, resolveTargetBase } from '../scheduler';
import type { LeaseFile, LeaseSummary } from './leaseTipos';

export function leaseDir(guardRoot: string): string {
  return path.join(guardRoot, 'leases');
}

export async function appendAudit(guardRoot: string, entry: Record<string, unknown>): Promise<void> {
  try {
    await fs.mkdir(leaseDir(guardRoot), { recursive: true });
    await fs.appendFile(
      path.join(guardRoot, 'leases', 'audit.ndjson'),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      'utf8',
    );
  } catch {
    /* La auditoría nunca rompe el flujo del guard ni del gate. */
  }
}

export async function listLeases(
  guardRoot: string = resolveGuardRoot(resolveTargetBase()),
  now: number = Date.now(),
): Promise<LeaseSummary[]> {
  const directory = leaseDir(path.resolve(guardRoot));
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const leases: LeaseSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const lease = JSON.parse(await fs.readFile(path.join(directory, entry.name), 'utf8')) as LeaseFile;
      if (lease.schemaVersion !== 1 || typeof lease.id !== 'string') continue;
      leases.push({
        id: lease.id,
        pid: lease.pid,
        projectRoot: lease.projectRoot,
        command: lease.command,
        taskId: lease.taskId ?? null,
        issuedAt: lease.issuedAt,
        expiresAt: lease.expiresAt,
        expired: !(now < Date.parse(lease.expiresAt)),
        path: path.join(directory, entry.name),
      });
    } catch {
      /* Archivo a medio escribir o no lease: se ignora. */
    }
  }
  return leases.sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
}

export async function pruneExpiredLeases(guardRoot: string, options: { now?: number } = {}): Promise<number> {
  const now = options.now ?? Date.now();
  const summaries = await listLeases(guardRoot, now);
  let pruned = 0;
  for (const summary of summaries) {
    if (!summary.expired) continue;
    try {
      await fs.unlink(summary.path);
      pruned += 1;
    } catch {
      /* Ya no existe. */
    }
  }
  if (pruned > 0) {
    await appendAudit(guardRoot, { event: 'prune', count: pruned });
  }
  return pruned;
}

export async function revokeLease(options: { leasePath: string; reason?: string }): Promise<{ revoked: boolean; reason: string }> {
  const { leasePath } = options;
  const guardRoot = path.dirname(path.dirname(path.resolve(leasePath)));
  let leaseId: string | null = null;
  try {
    leaseId = (JSON.parse(await fs.readFile(leasePath, 'utf8')) as LeaseFile).id;
  } catch {
    /* El archivo puede haber sido podado antes del revoke. */
  }
  try {
    await fs.unlink(leasePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { revoked: false, reason: 'lease-ya-ausente' };
    }
    throw error;
  }
  await appendAudit(guardRoot, {
    event: 'revoke',
    leaseId,
    pid: process.pid,
    reason: options.reason ?? 'cierre-del-gate',
  });
  return { revoked: true, reason: 'ok' };
}

export function formatLeaseList(leases: LeaseSummary[]): string {
  if (leases.length === 0) return 'No hay leases activos.\n';
  const lines = [`Leases: ${leases.length}`];
  for (const lease of leases) {
    lines.push(
      `  ${lease.expired ? '[expirado]' : '[activo]  '} ${lease.id} pid=${lease.pid} task=${lease.taskId ?? '-'} cmd=${lease.command} expira=${lease.expiresAt}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
