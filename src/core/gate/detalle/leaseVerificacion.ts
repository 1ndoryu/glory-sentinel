/* [028A-6] Verificación de leases: el proceso que verifica debe ser el emisor
 * o un descendiente suyo. Resolución del PID padre por plataforma sin tocar
 * el árbol de procesos. */
import * as fs from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { appendAudit } from './leaseRegistro';
import { keyPath, normalizeRoot, signLease } from './leaseClave';
import type { LeaseFile, LeaseVerification, VerifyLeaseOptions } from './leaseTipos';

const execFileAsync = promisify(execFile);
const MAX_PID_DEPTH = 64;

/* [028A-6] Resolución del padre real del proceso por plataforma, sin tocar
 * el árbol de procesos. Windows: PowerShell CIM (wmic está deprecado);
 * Linux: /proc/<pid>/stat (sin spawn); resto: ps. Devuelve null si no puede
 * resolverse (fail closed en el verificador). Presupuesto: cada salto en
 * Windows cuesta un proceso powershell (~1,3-1,6 s en reposo, medido el
 * 2026-10-10); el verificador solo se invoca para comandos que la política
 * iba a bloquear, y la cadena suele ser de 1-2 saltos (gate → shim → guard).
 * El límite de Windows debe cubrir el coste bajo carga: con 5 s, un salto
 * lento devolvía null y un lease legítimo se rechazaba en falso. */
const WINDOWS_PARENT_LOOKUP_TIMEOUT_MS = 20_000;

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
        { windowsHide: true, timeout: WINDOWS_PARENT_LOOKUP_TIMEOUT_MS },
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
