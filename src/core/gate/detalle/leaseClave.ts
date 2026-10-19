/* [028A-6] Clave HMAC del guard root y firma canónica de los leases. La clave
 * vive en el guard root (misma máquina) y los shims la verifican contra el
 * guard root donde está el lease. */
import { createHmac, randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import type { LeaseFile } from './leaseTipos';

export function normalizeRoot(value: string): string {
  return path.resolve(value).replace(/\\/gu, '/').toLowerCase();
}

/* [028A-6] Serialización canónica de la firma: el orden de campos es parte
 * del contrato. Cualquier cambio de formato invalida los leases existentes
 * (fail closed, correcto para un credencial de exención). */
function canonicalString(lease: LeaseFile): string {
  return [
    'v1',
    lease.id,
    lease.issuedAt,
    lease.expiresAt,
    String(lease.pid),
    lease.projectRoot,
    lease.command,
    lease.taskId ?? '',
  ].join('|');
}

export function signLease(secret: string, lease: LeaseFile): string {
  return createHmac('sha256', secret).update(canonicalString(lease)).digest('hex');
}

export function keyPath(guardRoot: string): string {
  return path.join(guardRoot, 'lease.key');
}

/* [028A-6] Clave de máquina: se crea una sola vez con compare-and-set (wx)
 * para no pisar una clave concurrente de otro gate; un symlink en la ruta se
 * rechaza (configuración externa no se carga, igual que en los shims). */
export async function loadOrCreateKey(guardRoot: string): Promise<string> {
  await fs.mkdir(guardRoot, { recursive: true });
  const filePath = keyPath(guardRoot);
  try {
    if (lstatSync(filePath).isSymbolicLink()) throw new Error('lease.key no puede ser un symlink');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  try {
    const existing = (await fs.readFile(filePath, 'utf8')).trim();
    if (/^[0-9a-f]{64}$/u.test(existing)) return existing;
  } catch {
    /* Ausente: se crea. Corrupto: se regenera solo si nadie más lo creó. */
  }
  const secret = randomBytes(32).toString('hex');
  try {
    await fs.writeFile(filePath, `${secret}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      const concurrent = (await fs.readFile(filePath, 'utf8')).trim();
      if (/^[0-9a-f]{64}$/u.test(concurrent)) return concurrent;
      throw new Error('lease.key concurrente corrupto');
    }
    throw error;
  }
  return secret;
}

export function keyPresent(guardRoot: string): boolean {
  try {
    return !lstatSync(keyPath(guardRoot)).isSymbolicLink();
  } catch {
    return false;
  }
}
