/* [028A-6 Fase 2] Leases efímeros firmados (SNT-10): el gate emite por
 * ejecución un lease HMAC-SHA256 que exime a sus propias herramientas
 * pesadas de los shims interceptores, atado a PID emisor, proyecto,
 * expiración y task ID, con auditoría append-only. Sustituye el
 * GLORY_QUALITY_GATE_TOKEN plano (exención por mera presencia) por un
 * credencial verificable: un token robado o copiado deja de servir fuera
 * del árbol de procesos del gate, en otro proyecto o tras expirar.
 *
 * La clave HMAC vive en el guard root del runtime (misma máquina); los shims
 * verifican contra el key del MISMO guard root donde vive el lease
 * (guardRoot = padre del directorio "leases"), por lo que no hay dependencia
 * del target base del operador ni de variables de entorno globales. */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { writeAtomic } from './atomicFile';
import { resolveGuardRoot, resolveTargetBase } from './scheduler';

const execFileAsync = promisify(execFile);

export const LEASE_ENV_VAR = 'GLORY_QUALITY_GATE_LEASE';
export const LEASE_DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PID_DEPTH = 64;

export interface LeasePayload {
  schemaVersion: 1;
  id: string;
  issuedAt: string;
  expiresAt: string;
  pid: number;
  projectRoot: string;
  command: string;
  taskId: string | null;
}

export interface LeaseFile extends LeasePayload {
  signature: string;
}

export interface IssueLeaseOptions {
  projectRoot: string;
  pid?: number;
  command?: string;
  taskId?: string | null;
  ttlMs?: number;
  now?: number;
  guardRoot?: string;
}

export interface IssuedLease {
  lease: LeaseFile;
  path: string;
  envVar: string;
}

export interface VerifyLeaseOptions {
  leasePath: string;
  projectRoot: string;
  pid: number;
  command: string;
  now?: number;
  parentPidOf?: (pid: number) => Promise<number | null>;
}

export interface LeaseVerification {
  valid: boolean;
  reason?: string;
  lease?: LeaseFile;
}

export interface LeaseSummary {
  id: string;
  pid: number;
  projectRoot: string;
  command: string;
  taskId: string | null;
  issuedAt: string;
  expiresAt: string;
  expired: boolean;
  path: string;
}

function normalizeRoot(value: string): string {
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

function signLease(secret: string, lease: LeaseFile): string {
  return createHmac('sha256', secret).update(canonicalString(lease)).digest('hex');
}

function keyPath(guardRoot: string): string {
  return path.join(guardRoot, 'lease.key');
}

/* [028A-6] Clave de máquina: se crea una sola vez con compare-and-set (wx)
 * para no pisar una clave concurrente de otro gate; un symlink en la ruta se
 * rechaza (configuración externa no se carga, igual que en los shims). */
async function loadOrCreateKey(guardRoot: string): Promise<string> {
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

function leaseDir(guardRoot: string): string {
  return path.join(guardRoot, 'leases');
}

async function appendAudit(guardRoot: string, entry: Record<string, unknown>): Promise<void> {
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

export function leaseTtlFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const ms = Number(env.GLORY_QUALITY_GATE_LEASE_TTL_MS);
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

/* [028A-6] Resolución del padre real del proceso por plataforma, sin tocar
 * el árbol de procesos. Windows: PowerShell CIM (wmic está deprecado);
 * Linux: /proc/<pid>/stat (sin spawn); resto: ps. Devuelve null si no puede
 * resolverse (fail closed en el verificador). Presupuesto: cada salto en
 * Windows cuesta un proceso powershell (~0,3-0,5 s); el verificador solo se
 * invoca para comandos que la política iba a bloquear, y la cadena suele
 * ser de 1-2 saltos (gate → shim → guard), así que el coste por comando
 * eximido es acotado. */
async function defaultParentPidOf(pid: number): Promise<number | null> {
  if (process.platform === 'linux') {
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      const rest = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u);
      const value = Number(rest[1]);
      return Number.isInteger(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ParentProcessId`],
        { windowsHide: true, timeout: 5000 },
      );
      const value = Number(String(stdout).trim());
      return Number.isInteger(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'ppid=', '-p', String(pid)], { timeout: 5000 });
    const value = Number(String(stdout).trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/* [028A-6] El proceso verificador debe ser el emisor o un descendiente suyo:
 * un lease copiado a otra terminal o a otro proceso no sirve. Caminata
 * acotada (64 niveles) con detección de ciclos. */
async function isAncestorOrSelf(
  pid: number,
  ancestorPid: number,
  parentPidOf: (pid: number) => Promise<number | null>,
): Promise<boolean> {
  if (pid === ancestorPid) return true;
  const seen = new Set<number>();
  let current = pid;
  for (let depth = 0; depth < MAX_PID_DEPTH; depth++) {
    if (seen.has(current)) return false;
    seen.add(current);
    const parent = await parentPidOf(current);
    if (parent === null || parent === 0) return false;
    if (parent === ancestorPid) return true;
    current = parent;
  }
  return false;
}

/* [028A-6] Verificación del lease en el guard: estructura, esquema, clave
 * del mismo guard root, firma, expiración, proyecto y PID descendiente, en
 * ese orden (las comprobaciones baratas van primero). Cada verificación
 * queda auditada con PID actual, PID emisor, proyecto, comando y task ID. */
export async function verifyLease(options: VerifyLeaseOptions): Promise<LeaseVerification> {
  const { leasePath } = options;
  const parentPidOf = options.parentPidOf ?? defaultParentPidOf;
  const now = options.now ?? Date.now();
  const guardRoot = path.dirname(path.dirname(path.resolve(leasePath)));
  const fail = async (reason: string, extra: Record<string, unknown> = {}): Promise<LeaseVerification> => {
    await appendAudit(guardRoot, {
      event: 'verify',
      leaseId: null,
      pid: options.pid,
      projectRoot: normalizeRoot(options.projectRoot),
      command: options.command,
      valid: false,
      reason,
      ...extra,
    });
    return { valid: false, reason };
  };

  /* [028A-6] Check estructural: la env solo puede apuntar a archivos dentro
   * de un directorio "leases" de un guard root. NO es la frontera de
   * seguridad (modelo same-user: quien controle la env podría crear su
   * propio guard root con su propia clave); la frontera real es la clave
   * HMAC del mismo guard root + el binding de PID descendiente + proyecto.
   * Este check solo evita apuntar a JSON que no son leases (p. ej. state). */
  if (path.basename(path.dirname(leasePath)) !== 'leases') {
    return fail('fuera-del-directorio-de-leases', { leasePath });
  }
  let lease: LeaseFile;
  try {
    lease = JSON.parse(await fs.readFile(leasePath, 'utf8')) as LeaseFile;
  } catch {
    return fail('lease-ilegible', { leasePath });
  }
  if (lease.schemaVersion !== 1 || typeof lease.id !== 'string' || lease.id.length === 0) {
    return fail('esquema-invalido', { leaseId: lease.id });
  }
  let secret: string;
  try {
    if (lstatSync(keyPath(guardRoot)).isSymbolicLink()) return fail('clave-symlink', { leaseId: lease.id });
    secret = (await fs.readFile(keyPath(guardRoot), 'utf8')).trim();
    if (!/^[0-9a-f]{64}$/u.test(secret)) return fail('clave-corrupta', { leaseId: lease.id });
  } catch {
    return fail('clave-ausente', { leaseId: lease.id });
  }
  if (lease.signature !== signLease(secret, lease)) {
    return fail('firma-invalida', { leaseId: lease.id });
  }
  if (!(now < Date.parse(lease.expiresAt))) {
    return fail('expirado', { leaseId: lease.id });
  }
  if (normalizeRoot(lease.projectRoot) !== normalizeRoot(options.projectRoot)) {
    return fail('proyecto-distinto', { leaseId: lease.id, leaseProjectRoot: lease.projectRoot });
  }
  if (!(await isAncestorOrSelf(options.pid, lease.pid, parentPidOf))) {
    return fail('pid-no-descendiente', { leaseId: lease.id, leasePid: lease.pid });
  }
  await appendAudit(guardRoot, {
    event: 'verify',
    leaseId: lease.id,
    pid: options.pid,
    ancestorPid: lease.pid,
    projectRoot: lease.projectRoot,
    command: options.command,
    taskId: lease.taskId,
    valid: true,
  });
  return { valid: true, lease };
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

export function keyPresent(guardRoot: string): boolean {
  try {
    return !lstatSync(keyPath(guardRoot)).isSymbolicLink();
  } catch {
    return false;
  }
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
