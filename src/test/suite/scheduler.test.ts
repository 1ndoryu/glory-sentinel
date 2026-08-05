/* [028A-6 Fase 1] Tests del scheduler (extraído de
 * scripts/quality/tests/heavy-run-guard.test.mjs): cooldown de full, lock de
 * ejecuciones pesadas y resolución de raíz por marcador declarativo. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  acquireHeavyRun,
  findQualityRoot,
  formatHeavyGuardMessage,
  HeavyRunLease,
  inspectHeavyRun,
  isHeavyCargoCommand,
} from '../../core/scheduler';

function guardRootFor(targetBase: string): string {
  return path.join(path.dirname(path.resolve(targetBase)), 'glory-quality-guard');
}

suite('Sentinel core scheduler (orquestador agnóstico)', () => {
  test('el guard limita full a una ejecución cada tres horas y permite override explícito', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-heavy-guard-'));
    const targetBase = path.join(root, 'target');
    try {
      fs.writeFileSync(
        path.join(root, 'quality.config.json'),
        JSON.stringify({ heavyRun: { cooldownMinutes: 180 } }),
        'utf8',
      );
      const first = (await acquireHeavyRun({ projectRoot: root, targetBase, mode: 'full', taskId: '028A-3' }));
      assert.strictEqual(first.allowed, true);
      await (first as HeavyRunLease).release({ status: 'pass' });

      const blocked = await inspectHeavyRun({ projectRoot: root, targetBase, mode: 'full' });
      assert.strictEqual(blocked.allowed, false);
      assert.strictEqual(blocked.reason, 'cooldown');
      const override = (await acquireHeavyRun({ projectRoot: root, targetBase, mode: 'full', allowHeavy: true }));
      assert.strictEqual(override.allowed, true);
      await (override as HeavyRunLease).release({ status: 'pass' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(guardRootFor(targetBase), { recursive: true, force: true });
    }
  });

  test('el guard bloquea dos ejecuciones pesadas simultáneas', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-heavy-active-'));
    const targetBase = path.join(root, 'target');
    try {
      const first = await acquireHeavyRun({ projectRoot: root, targetBase, mode: 'full', allowHeavy: true });
      const second = await acquireHeavyRun({ projectRoot: root, targetBase, mode: 'full', allowHeavy: true });
      assert.strictEqual(first.allowed, true);
      assert.strictEqual(second.allowed, false);
      assert.strictEqual(second.reason, 'active');
      await (first as HeavyRunLease).release({ status: 'pass' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(guardRootFor(targetBase), { recursive: true, force: true });
    }
  });

  test('findQualityRoot resuelve el directorio físico y omite marcadores symlink', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-heavy-root-'));
    const physical = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-heavy-physical-'));
    try {
      fs.mkdirSync(path.join(root, 'scripts', 'quality'), { recursive: true });
      fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(root, 'quality.config.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(root, 'scripts', 'quality', 'heavy-run-guard.mjs'), '', 'utf8');
      const linked = path.join(physical, 'linked');
      fs.symlinkSync(root, linked, 'junction');
      assert.strictEqual(await findQualityRoot(path.join(linked, 'nested')), root);

      const candidate = path.join(root, 'child');
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-heavy-marker-outside-'));
      fs.mkdirSync(path.join(candidate, 'scripts', 'quality'), { recursive: true });
      fs.writeFileSync(path.join(outside, 'quality.config.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(outside, 'heavy-run-guard.mjs'), '', 'utf8');
      fs.symlinkSync(path.join(outside, 'quality.config.json'), path.join(candidate, 'quality.config.json'), 'file');
      fs.symlinkSync(
        path.join(outside, 'heavy-run-guard.mjs'),
        path.join(candidate, 'scripts', 'quality', 'heavy-run-guard.mjs'),
        'file',
      );
      assert.strictEqual(await findQualityRoot(candidate), root);
      fs.rmSync(outside, { recursive: true, force: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(physical, { recursive: true, force: true });
    }
  });

  test('findQualityRoot conserva fallback para una ruta inexistente', async () => {
    const missing = path.join(os.tmpdir(), 'sentinel-heavy-missing-root', 'nested');
    assert.strictEqual(await findQualityRoot(missing), path.resolve(missing));
  });

  test('solo test, clippy y bench son comandos Cargo pesados', () => {
    assert.strictEqual(isHeavyCargoCommand(['test']), true);
    assert.strictEqual(isHeavyCargoCommand(['--locked', 'clippy']), true);
    assert.strictEqual(isHeavyCargoCommand(['check']), false);
    assert.strictEqual(isHeavyCargoCommand(['fmt', '--check']), false);
  });

  test('el cooldown de full no se comparte entre proyectos con el mismo targetBase', async () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-heavy-project-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-heavy-project-b-'));
    const targetBase = path.join(rootA, 'target');
    try {
      for (const root of [rootA, rootB]) {
        fs.writeFileSync(
          path.join(root, 'quality.config.json'),
          JSON.stringify({ heavyRun: { cooldownMinutes: 180 } }),
          'utf8',
        );
      }
      /* [028A-6] El cooldown vive en state.projects keyed por projectKey(root):
       * un full en A no debe bloquear un full en B aunque compartan targetBase. */
      const first = await acquireHeavyRun({ projectRoot: rootA, targetBase, mode: 'full', taskId: '028A-6' });
      assert.strictEqual(first.allowed, true);
      await (first as HeavyRunLease).release({ status: 'pass' });

      const blockedA = await inspectHeavyRun({ projectRoot: rootA, targetBase, mode: 'full' });
      assert.strictEqual(blockedA.allowed, false);
      assert.strictEqual(blockedA.reason, 'cooldown');
      const allowedB = await inspectHeavyRun({ projectRoot: rootB, targetBase, mode: 'full' });
      assert.strictEqual(allowedB.allowed, true);
    } finally {
      for (const root of [rootA, rootB]) {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(guardRootFor(targetBase), { recursive: true, force: true });
      }
    }
  });

  test('formatHeavyGuardMessage explica cooldown y lock activo', () => {
    const cooldown = formatHeavyGuardMessage({
      allowed: false,
      reason: 'cooldown',
      cooldownMs: 180 * 60_000,
      remainingMs: 120 * 60_000,
      nextAllowedAt: '2026-08-05T10:00:00.000Z',
    });
    assert.match(cooldown, /faltan aproximadamente 120 min/);
    assert.match(cooldown, /2026-08-05T10:00:00.000Z/);
    assert.match(cooldown, /--allow-heavy/);
    const active = formatHeavyGuardMessage({
      allowed: false,
      reason: 'active',
      message: 'Ya existe una ejecución pesada activa (PID 123).',
    });
    assert.match(active, /PID 123/);
    const generic = formatHeavyGuardMessage({ allowed: false });
    assert.match(generic, /otra ejecución pesada activa/);
  });

  test('un comando ligero no adquiere lease ni escribe cooldown', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-heavy-light-'));
    const targetBase = path.join(root, 'target');
    try {
      fs.writeFileSync(
        path.join(root, 'quality.config.json'),
        JSON.stringify({ heavyRun: { cooldownMinutes: 180 } }),
        'utf8',
      );
      assert.strictEqual(isHeavyCargoCommand(['check']), false);
      assert.strictEqual(isHeavyCargoCommand(['build']), false);
      const light = await inspectHeavyRun({ projectRoot: root, targetBase, mode: 'local-light' });
      assert.strictEqual(light.allowed, true);
      const afterLight = await inspectHeavyRun({ projectRoot: root, targetBase, mode: 'full' });
      assert.strictEqual(afterLight.allowed, true, 'un comando ligero no puede arrancar el cooldown');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(guardRootFor(targetBase), { recursive: true, force: true });
    }
  });
});
