/* [028A-6 Fase 2] Tests de leases efímeros firmados (SNT-10): emisión con
 * clave HMAC del guard root, verificación (firma, expiración, proyecto, PID
 * descendiente), revocación, poda y auditoría. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  LEASE_ENV_VAR,
  issueLease,
  verifyLease,
  revokeLease,
  listLeases,
  pruneExpiredLeases,
  keyPresent,
} from '../../core/lease';

function makeGuardRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-lease-guard-'));
}

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-lease-proj-'));
}

function auditLines(guardRoot: string): string[] {
  try {
    return fs.readFileSync(path.join(guardRoot, 'leases', 'audit.ndjson'), 'utf8')
      .split('\n')
      .filter(line => line.trim().length > 0);
  } catch {
    return [];
  }
}

suite('Sentinel core leases efímeros firmados (Fase 2/SNT-10)', () => {
  test('issue crea el lease firmado, el key y envVar apunta al archivo', async () => {
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    try {
      const issued = await issueLease({ projectRoot: project, guardRoot, taskId: '297A-99', command: 'cargo test' });
      assert.ok(fs.existsSync(issued.path), 'el lease se escribe en disco');
      assert.strictEqual(issued.envVar, LEASE_ENV_VAR);
      assert.ok(keyPresent(guardRoot), 'la clave HMAC se crea en el guard root');
      const lease = JSON.parse(fs.readFileSync(issued.path, 'utf8'));
      assert.strictEqual(lease.schemaVersion, 1);
      assert.strictEqual(lease.pid, process.pid);
      assert.strictEqual(lease.taskId, '297A-99');
      assert.strictEqual(lease.command, 'cargo test');
      assert.ok(/^[0-9a-f]{64}$/u.test(lease.signature), 'la firma es HMAC-SHA256 hex');
      assert.ok(Date.parse(lease.expiresAt) > Date.parse(lease.issuedAt), 'expira en el futuro');
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('la clave se reutiliza entre emisiones (compare-and-set sin pisar)', async () => {
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    try {
      const first = await issueLease({ projectRoot: project, guardRoot });
      const firstKey = fs.readFileSync(path.join(guardRoot, 'lease.key'), 'utf8');
      const second = await issueLease({ projectRoot: project, guardRoot });
      assert.strictEqual(fs.readFileSync(path.join(guardRoot, 'lease.key'), 'utf8'), firstKey);
      assert.notStrictEqual(first.path, second.path, 'cada emisión tiene su propio lease');
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('verify valida un lease vigente del mismo proyecto y PID', async () => {
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    try {
      const issued = await issueLease({ projectRoot: project, guardRoot });
      const verification = await verifyLease({
        leasePath: issued.path,
        projectRoot: project,
        pid: process.pid,
        command: 'cargo',
      });
      assert.strictEqual(verification.valid, true);
      assert.strictEqual(verification.lease?.id, issued.lease.id);
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('verify rechaza un lease de otro proyecto', async () => {
    const guardRoot = makeGuardRoot();
    const projectA = makeProject();
    const projectB = makeProject();
    try {
      const issued = await issueLease({ projectRoot: projectA, guardRoot });
      const verification = await verifyLease({
        leasePath: issued.path,
        projectRoot: projectB,
        pid: process.pid,
        command: 'cargo',
      });
      assert.strictEqual(verification.valid, false);
      assert.strictEqual(verification.reason, 'proyecto-distinto');
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(projectA, { recursive: true, force: true });
      fs.rmSync(projectB, { recursive: true, force: true });
    }
  });

  test('verify rechaza un lease expirado', async () => {
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    try {
      const issued = await issueLease({ projectRoot: project, guardRoot, ttlMs: 60_000, now: 1_000_000 });
      const verification = await verifyLease({
        leasePath: issued.path,
        projectRoot: project,
        pid: process.pid,
        command: 'cargo',
        now: Date.now(),
      });
      assert.strictEqual(verification.valid, false);
      assert.strictEqual(verification.reason, 'expirado');
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('verify rechaza un lease manipulado (firma inválida)', async () => {
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    try {
      const issued = await issueLease({ projectRoot: project, guardRoot });
      const lease = JSON.parse(fs.readFileSync(issued.path, 'utf8'));
      lease.command = 'malware';
      fs.writeFileSync(issued.path, JSON.stringify(lease), 'utf8');
      const verification = await verifyLease({
        leasePath: issued.path,
        projectRoot: project,
        pid: process.pid,
        command: 'node',
      });
      assert.strictEqual(verification.valid, false);
      assert.strictEqual(verification.reason, 'firma-invalida');
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('verify rechaza un PID que no desciende del emisor', async () => {
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    try {
      const issued = await issueLease({ projectRoot: project, guardRoot, pid: 999_999_999 });
      const verification = await verifyLease({
        leasePath: issued.path,
        projectRoot: project,
        pid: process.pid,
        command: 'node',
        parentPidOf: async () => null,
      });
      assert.strictEqual(verification.valid, false);
      assert.strictEqual(verification.reason, 'pid-no-descendiente');
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('verify valida un proceso descendiente REAL del emisor', async function () {
    this.timeout(30_000);
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore' });
    try {
      const issued = await issueLease({ projectRoot: project, guardRoot, pid: process.pid });
      assert.ok(child.pid, 'el hijo se lanza con PID');
      const verification = await verifyLease({
        leasePath: issued.path,
        projectRoot: project,
        pid: child.pid!,
        command: 'node',
      });
      assert.strictEqual(verification.valid, true, 'la cadena real de procesos resuelve al emisor');
    } finally {
      child.kill();
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('verify rechaza una ruta fuera del directorio de leases', async () => {
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    try {
      const stray = path.join(guardRoot, 'no-es-lease.json');
      fs.writeFileSync(stray, '{}', 'utf8');
      const verification = await verifyLease({
        leasePath: stray,
        projectRoot: project,
        pid: process.pid,
        command: 'node',
      });
      assert.strictEqual(verification.valid, false);
      assert.strictEqual(verification.reason, 'fuera-del-directorio-de-leases');
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('revoke elimina el lease y registra la revocación', async () => {
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    try {
      const issued = await issueLease({ projectRoot: project, guardRoot });
      const result = await revokeLease({ leasePath: issued.path, reason: 'test' });
      assert.strictEqual(result.revoked, true);
      assert.ok(!fs.existsSync(issued.path), 'el lease se elimina');
      assert.ok(auditLines(guardRoot).some(line => line.includes('"event":"revoke"')), 'la auditoría registra el revoke');
      const again = await revokeLease({ leasePath: issued.path });
      assert.strictEqual(again.revoked, false);
      assert.strictEqual(again.reason, 'lease-ya-ausente');
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('la auditoría registra issue/verify/revoke con los campos auditados', async () => {
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    try {
      const issued = await issueLease({ projectRoot: project, guardRoot, taskId: 'AUDIT-1', command: 'npm test' });
      await verifyLease({ leasePath: issued.path, projectRoot: project, pid: process.pid, command: 'npm' });
      await revokeLease({ leasePath: issued.path, reason: 'cierre' });
      const lines = auditLines(guardRoot);
      assert.ok(lines.some(line => line.includes('"event":"issue"') && line.includes('AUDIT-1')), 'issue audita taskId');
      assert.ok(lines.some(line => line.includes('"event":"verify"') && line.includes('"valid":true') && line.includes('"command":"npm"')), 'verify audita comando y validez');
      assert.ok(lines.some(line => line.includes('"event":"revoke"')), 'revoke audita');
      assert.ok(lines.some(line => line.includes(`"pid":${process.pid}`)), 'los eventos auditan el PID');
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('prune elimina solo los expirados y list ordena', async () => {
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    try {
      /* [028A-6] El activo primero: cada issueLease poda internamente lo
       * expirado, y el expirado se emite con now histórico para que la poda
       * interna (now=1_000_000) no lo toque todavía. */
      const active = await issueLease({ projectRoot: project, guardRoot, ttlMs: 60_000, now: Date.now() });
      const expired = await issueLease({ projectRoot: project, guardRoot, ttlMs: 60_000, now: 1_000_000 });
      const pruned = await pruneExpiredLeases(guardRoot, { now: Date.now() });
      assert.strictEqual(pruned, 1);
      assert.ok(!fs.existsSync(expired.path), 'el lease expirado se poda');
      assert.ok(fs.existsSync(active.path), 'el lease activo se conserva');
      const leases = await listLeases(guardRoot, Date.now());
      assert.strictEqual(leases.length, 1);
      assert.strictEqual(leases[0].id, active.lease.id);
      assert.strictEqual(leases[0].expired, false);
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('verify con lease ausente o clave ausente falla cerrado', async () => {
    const guardRoot = makeGuardRoot();
    const project = makeProject();
    try {
      const missing = await verifyLease({
        leasePath: path.join(guardRoot, 'leases', 'no-existe.json'),
        projectRoot: project,
        pid: process.pid,
        command: 'node',
      });
      assert.strictEqual(missing.valid, false);
      assert.ok(['lease-ilegible', 'fuera-del-directorio-de-leases', 'clave-ausente'].includes(missing.reason ?? ''));
    } finally {
      fs.rmSync(guardRoot, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
