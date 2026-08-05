/* [028A-6 Fase 1] Tests del guard de comandos directos (extraído de
 * scripts/quality/quality-command-guard.mjs): política v2, fallback v1,
 * observe/enforce e invalid-policy sin bloquear comandos desconocidos. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatBlockMessage, inspectDirectCommand, QUALITY_GUARD_EXIT_CODE } from '../../core/guardCommand';

function writeV2Policy(root: string, mode: string, directCommands: Record<string, string[]>): void {
  fs.writeFileSync(path.join(root, 'sentinel.config.json'), JSON.stringify({
    schemaVersion: 2,
    mode,
    gate: { command: ['sentinel', 'check', '--'], taskIdRequired: true },
    guard: { directCommands },
  }), 'utf8');
}

suite('Sentinel core guard command (orquestador agnóstico)', () => {
  test('no-policy no bloquea nada', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-guard-nopolicy-'));
    try {
      fs.writeFileSync(path.join(root, 'quality.config.json'), '{}', 'utf8');
      const decision = await inspectDirectCommand({ executable: 'npm', args: ['run', 'test'], projectRoot: root });
      assert.strictEqual(decision.blocked, false);
      assert.strictEqual(decision.policyStatus, 'no-policy');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('sin marcador declarativo no hay raíz ni bloqueo', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-guard-nomarker-'));
    try {
      const decision = await inspectDirectCommand({ executable: 'npm', args: ['run', 'test'], projectRoot: root });
      assert.strictEqual(decision.blocked, false);
      assert.strictEqual(decision.root, null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('fallback legacy v1 conserva los defaults y bloquea', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-guard-legacy-'));
    try {
      fs.writeFileSync(path.join(root, 'sentinel.config.json'), JSON.stringify({ schemaVersion: 1, rules: {} }), 'utf8');
      const decision = await inspectDirectCommand({ executable: 'npm', args: ['run', 'test'], projectRoot: root });
      assert.strictEqual(decision.blocked, true);
      assert.strictEqual(decision.category, 'script');
      assert.strictEqual(decision.exitCode, QUALITY_GUARD_EXIT_CODE);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('política v2 enforce bloquea lo declarado y deja pasar lo demás', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-guard-enforce-'));
    try {
      writeV2Policy(root, 'enforce', {
        npmScripts: ['test'],
        npxTools: ['tsc'],
        cargoSubcommands: ['check'],
        tools: ['rustfmt'],
      });
      const npm = await inspectDirectCommand({ executable: 'npm', args: ['run', 'test'], projectRoot: root });
      assert.strictEqual(npm.blocked, true);
      assert.strictEqual(npm.command, 'npm test');
      assert.strictEqual(npm.exitCode, QUALITY_GUARD_EXIT_CODE);
      const dev = await inspectDirectCommand({ executable: 'npm', args: ['run', 'dev'], projectRoot: root });
      assert.strictEqual(dev.blocked, false);
      const cargo = await inspectDirectCommand({ executable: 'cargo.exe', args: ['check'], projectRoot: root });
      assert.strictEqual(cargo.blocked, true);
      assert.strictEqual(cargo.category, 'cargo');
      const vitest = await inspectDirectCommand({ executable: 'npx', args: ['vitest'], projectRoot: root });
      assert.strictEqual(vitest.blocked, false, 'vitest no está declarado');
      const rustfmt = await inspectDirectCommand({ executable: 'rustfmt', args: [], projectRoot: root });
      assert.strictEqual(rustfmt.blocked, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('política v2 observe no bloquea pero observa', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-guard-observe-'));
    try {
      writeV2Policy(root, 'observe', { npmScripts: ['test'], npxTools: [], cargoSubcommands: [], tools: [] });
      const decision = await inspectDirectCommand({ executable: 'npm', args: ['run', 'test'], projectRoot: root });
      assert.strictEqual(decision.blocked, false);
      assert.strictEqual(decision.observed, 'npm test');
      assert.ok(!decision.exitCode);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('invalid-policy no bloquea comandos desconocidos', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-guard-invalid-'));
    try {
      fs.writeFileSync(path.join(root, 'sentinel.config.json'), JSON.stringify({
        schemaVersion: 2,
        // sin mode ni guard: política inválida
      }), 'utf8');
      const unknown = await inspectDirectCommand({ executable: 'weird-tool', args: [], projectRoot: root });
      assert.strictEqual(unknown.blocked, false);
      assert.strictEqual(unknown.policyStatus, 'invalid-policy');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('el token del gate exime invocaciones internas', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-guard-token-'));
    try {
      writeV2Policy(root, 'enforce', { npmScripts: ['test'], npxTools: [], cargoSubcommands: [], tools: [] });
      const decision = await inspectDirectCommand({
        executable: 'npm',
        args: ['run', 'test'],
        projectRoot: root,
        env: { GLORY_QUALITY_GATE_TOKEN: 'internal' },
      });
      assert.strictEqual(decision.blocked, false);
      assert.strictEqual(decision.root, null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('formatBlockMessage recomienda el gate canónico', () => {
    const message = formatBlockMessage({ blocked: true, command: 'npm test', root: '/tmp' });
    assert.match(message, /BLOQUEADO/);
    assert.match(message, /npm test/);
    assert.match(message, /sentinel check/);
  });
});
