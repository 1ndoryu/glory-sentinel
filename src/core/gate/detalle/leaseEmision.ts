/* [028A-6 Fase 2] Emisión de leases (SNT-10): genera el lease HMAC firmado
 * del gate, lo escribe de forma atómica y registra la auditoría. Lo
 * re-exporta lease.ts (API pública sin cambios). */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from '../../seguridad-rutas/atomicFile';
import { leerEntornoSentinel } from '../../entorno/variablesSentinel';
import { resolveGuardRoot, resolveTargetBase } from '../scheduler';
import { LEASE_DEFAULT_TTL_MS, LEASE_ENV_VAR } from './leaseTipos';
import type { IssueLeaseOptions, IssuedLease, LeaseFile } from './leaseTipos';
import { loadOrCreateKey, normalizeRoot, signLease } from './leaseClave';
import { appendAudit, leaseDir, pruneExpiredLeases } from './leaseRegistro';
export function leaseTtlFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const ms = Number(leerEntornoSentinel(env, 'SENTINEL_GATE_LEASE_TTL_MS'));
  return Number.isFinite(ms) && ms > 0 ? ms : LEASE_DEFAULT_TTL_MS;
}

export async function issueLease(options: IssueLeaseOptions): Promise<IssuedLease> {
  const guardRoot = path.resolve(options.guardRoot ?? resolveGuardRoot(resolveTargetBase()));
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? leaseTtlFromEnv();
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttlMs del lease debe ser positivo');
  const pid = options.pid ?? process.pid;
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('pid del lease inválido');
  const secret = await loadOrCreateKey(guardRoot);
  const lease: LeaseFile = {
    schemaVersion: 1,
    id: randomUUID(),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    pid,
    projectRoot: normalizeRoot(options.projectRoot),
    command: options.command ?? 'gate',
    taskId: options.taskId ?? null,
    signature: '',
  };
  lease.signature = signLease(secret, lease);
  const directory = leaseDir(guardRoot);
  await fs.mkdir(directory, { recursive: true });
  const leasePath = path.join(directory, `${lease.id}.json`);
  await writeAtomic(leasePath, `${JSON.stringify(lease, null, 2)}\n`);
  await appendAudit(guardRoot, {
    event: 'issue',
    leaseId: lease.id,
    pid: lease.pid,
    projectRoot: lease.projectRoot,
    command: lease.command,
    taskId: lease.taskId,
    expiresAt: lease.expiresAt,
  });
  /* La emisión poda leases olvidados por gates colgados; best-effort. */
  await pruneExpiredLeases(guardRoot, { now }).catch(() => {});
  return { lease, path: leasePath, envVar: LEASE_ENV_VAR };
}
