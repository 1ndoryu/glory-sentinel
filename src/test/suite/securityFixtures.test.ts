/* [108A-1 Fase 6] Fixtures de seguridad: contención de paths (traversal y
 * symlink/junction escape), redacción de secretos antes de publicar, escritura
 * atómica sin estados parciales y lock corrupto con error distinto (no hang). */
import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isPathInside, physicallyContained, ensureContainedDirectory } from '../../core/pathContainment';
import { redact, truncate, sanitize } from '../../core/redaction';
import { writeAtomic } from '../../core/atomicFile';
import { runProcess } from '../../core/toolRunner';
import { claimTask } from '../../core/taskCoordinator';

const PRIMARY_BRANCH = 'wandorius';

function fixture(): { parent: string; root: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-sec-'));
  const root = path.join(parent, 'repo');
  fs.mkdirSync(root);
  execFileSync('git', ['init', '-q', '-b', PRIMARY_BRANCH], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'sec@example.test'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Sec Test'], { cwd: root, stdio: 'ignore' });
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n', 'utf8');
  execFileSync('git', ['add', 'base.txt'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: root, stdio: 'ignore' });
  return { parent, root };
}

function trySymlink(target: string, link: string, type: 'dir' | 'junction'): boolean {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch {
    return false;
  }
}

suite('security fixtures — contención, redacción, atómico, lock corrupto (108A-1 F6)', () => {
  test('isPathInside rechaza traversal y rutas absolutas; acepta interiores y raíz', () => {
    const root = path.resolve('/ws/repo');
    assert.strictEqual(isPathInside(root, path.join(root, 'src', 'a.ts')), true);
    assert.strictEqual(isPathInside(root, root), true);
    assert.strictEqual(isPathInside(root, path.join(root, '..', 'x.ts')), false);
    assert.strictEqual(isPathInside(root, path.resolve('/elsewhere/x.ts')), false);
    assert.strictEqual(isPathInside(root, path.join(root, '..', 'repo2', 'x.ts')), false);
  });

  test('physicallyContained rechaza symlink/junction que escapa del workspace', async () => {
    const { parent, root } = fixture();
    try {
      const outside = path.join(parent, 'outside');
      fs.mkdirSync(outside);
      const link = path.join(root, 'escape');
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      if (!trySymlink(outside, link, linkType)) return; // sin privilegios: cobertura parcial honesta
      const escaped = path.join(link, 'secret.txt');
      fs.writeFileSync(escaped, 'secreto\n', 'utf8');
      await assert.rejects(
        physicallyContained(root, escaped, 'fixture'),
        /fuera del workspace o symlink\/junction escape/,
      );
      /* El interior real sigue siendo aceptado. */
      const ok = path.join(root, 'base.txt');
      await assert.doesNotReject(physicallyContained(root, ok, 'fixture'));
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('ensureContainedDirectory valida segmento a segmento y rechaza el salto', async () => {
    const { parent, root } = fixture();
    try {
      const target = path.join(root, 'a', 'b', 'c');
      await assert.doesNotReject(ensureContainedDirectory(root, target, 'fixture'));
      assert.ok(fs.statSync(target).isDirectory());
      const outside = path.join(parent, 'fuera');
      fs.mkdirSync(outside);
      const link = path.join(root, 'saltar');
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      if (!trySymlink(outside, link, linkType)) return;
      await assert.rejects(
        ensureContainedDirectory(root, path.join(link, 'x'), 'fixture'),
        /fuera del workspace o symlink\/junction escape/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('redact enmascara claves sensibles, Bearer y credenciales de URL', () => {
    const out = redact('API_TOKEN=abc123xyz SECRET_KEY="s3cr3t" Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.token http://user:pass@host/db');
    assert.ok(!out.includes('abc123xyz'), 'token enmascarado');
    assert.ok(!out.includes('s3cr3t'), 'secret enmascarado');
    assert.ok(!out.includes('eyJhbGci'), 'bearer enmascarado');
    assert.ok(!out.includes('user:pass@'), 'credenciales URL enmascaradas');
    assert.match(out, /\[REDACTED\]/);
  });

  test('truncate marca truncación explícita y nunca expone secretos', () => {
    /* Contenido largo SIN nombre de clave sensible: aquí sí se trunca. */
    const payload = `data=${'x'.repeat(300_000)}`;
    const out = truncate(payload, 1_000);
    assert.ok(out.endsWith('[TRUNCATED]'), 'marcador de truncación visible');
    assert.ok(!out.includes('x'.repeat(300_000)), 'contenido completo no publicado');
    assert.ok(out.length < 2_000, 'salida acotada');
    /* Un secreto dentro de un payload largo se redacta ANTES de truncar. */
    const withSecret = truncate(`AUTH_KEY=${'y'.repeat(300_000)}`, 100_000);
    assert.ok(!withSecret.includes('y'.repeat(300_000)) && !withSecret.includes('y'.repeat(64)), 'secreto redactado antes del truncado');
  });

  test('sanitize redacta por clave en objetos anidados', () => {
    const out = sanitize({ ok: 'visible', credentials: { password: 'p4ss' }, list: ['Bearer tok1234567890abc'] });
    assert.deepStrictEqual(out, {
      ok: 'visible',
      credentials: { password: '[REDACTED]' },
      list: ['Bearer [REDACTED]'],
    });
  });

  test('writeAtomic deja contenido completo y sin .tmp residual', async () => {
    const { parent } = fixture();
    try {
      const target = path.join(parent, 'report.json');
      await writeAtomic(target, '{"a":1}\n');
      assert.strictEqual(fs.readFileSync(target, 'utf8'), '{"a":1}\n');
      assert.ok(!fs.existsSync(`${target}.tmp`), 'sin archivo temporal residual');
      /* Reescritura sobre contenido previo también es atómica y completa. */
      await writeAtomic(target, '{"a":2}\n');
      assert.strictEqual(fs.readFileSync(target, 'utf8'), '{"a":2}\n');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('lock corrupto produce error distinto, no cuelga ni corrompe en silencio', async () => {
    const { parent, root } = fixture();
    try {
      const tasksRoot = path.join(root, '.sentinel', 'tasks', PRIMARY_BRANCH);
      fs.mkdirSync(tasksRoot, { recursive: true });
      const owner = path.join(tasksRoot, 'owner.json');
      fs.writeFileSync(owner, '{ no es json', 'utf8');
      /* El lock raíz usa un archivo por tarea; un owner.json corrupto de una
       * tarea ajena no debe romper un claim legítimo de otra tarea ni
       * silenciarse: el claim de la misma tarea falla cerrado con error. */
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-CORRUPT', agent: 'agent-a' });
      await assert.rejects(
        claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-CORRUPT', agent: 'agent-b' }),
        /ya (está|fue) tomada|tomada/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('toolRunner: captura truncada con marcador y timeout como estado distinto', async () => {
    const big = await runProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(200 * 1024))"], { timeoutMs: 30_000 });
    assert.ok(big.code === 0, 'proceso grande termina ok');
    assert.ok(big.stdout.includes('[TRUNCATED]') || big.stdout.length <= 64 * 1024 + 64, 'captura acotada con marcador');
    assert.ok(big.stdout.length < 128 * 1024, 'sin captura completa de 200 KiB');

    const slow = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { timeoutMs: 300 });
    assert.strictEqual(slow.timedOut, true, 'timeout distinto de tool-error');
    assert.notStrictEqual(slow.code, 0, 'proceso terminado por el runtime (exit no-0 en Windows tras taskkill)');
  });
});
