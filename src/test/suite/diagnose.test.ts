/* [028A-6 Fase 1] Tests del diagnóstico de `sentinel doctor`/`status`
 * (política, lock, scheduler y raíz). Solo lectura: los tests usan
 * CARGO_TARGET_DIR_BASE aislado para no tocar el guard root real. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { diagnoseWorkspace, formatDiagnose, formatStatus } from '../../core/diagnose';

suite('Sentinel core diagnose (orquestador agnóstico)', () => {
  test('detecta política v2 con hash, lock y scheduler', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-diagnose-v2-'));
    const previous = process.env.CARGO_TARGET_DIR_BASE;
    process.env.CARGO_TARGET_DIR_BASE = path.join(root, 'target-base');
    try {
      fs.writeFileSync(path.join(root, 'sentinel.config.json'), JSON.stringify({
        schemaVersion: 2,
        mode: 'enforce',
        gate: { command: ['sentinel', 'check', '--'], taskIdRequired: true },
        guard: { directCommands: { npmScripts: ['test'], npxTools: [], cargoSubcommands: [], tools: [] } },
      }), 'utf8');
      fs.writeFileSync(path.join(root, 'sentinel.lock.json'), JSON.stringify({
        schemaVersion: 1,
        analyzers: { sentinel: { version: '0.4.0', commit: '7f5b0867d8209eab728bfda4a502c82a52a35c9e' } },
      }), 'utf8');
      const result = await diagnoseWorkspace(root);
      assert.strictEqual(result.root, root);
      assert.strictEqual(result.policy.status, 'policy');
      assert.strictEqual(result.policy.mode, 'enforce');
      assert.strictEqual(result.policy.policyHash?.length, 64);
      assert.strictEqual(result.lock.present, true);
      assert.strictEqual(result.lock.commit, '7f5b0867d8209eab728bfda4a502c82a52a35c9e');
      assert.ok(result.scheduler?.guardRoot.includes('glory-quality-guard'));
      assert.match(formatDiagnose(result), /enforce/);
      assert.match(formatStatus(result), /enforce:enforce/);
    } finally {
      if (previous === undefined) delete process.env.CARGO_TARGET_DIR_BASE;
      else process.env.CARGO_TARGET_DIR_BASE = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('sin política reporta no-policy y sin lock', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-diagnose-nopolicy-'));
    try {
      const result = await diagnoseWorkspace(root);
      assert.strictEqual(result.policy.status, 'no-policy');
      assert.strictEqual(result.policy.policyHash, null);
      assert.strictEqual(result.lock.present, false);
      assert.match(formatStatus(result), /no-policy/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
