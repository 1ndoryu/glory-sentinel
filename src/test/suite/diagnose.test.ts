/* [028A-6 Fase 1/SNT-16d] Tests del diagnóstico de `sentinel doctor`/`status`.
 * El doctor es solo lectura y debe identificar prerequisitos faltantes antes
 * de que un gate falle a mitad de ejecución. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { diagnoseWorkspace, formatDiagnose, formatStatus } from '../../core/diagnose';

function policy(): object {
  return {
    schemaVersion: 2,
    mode: 'enforce',
    gate: { command: ['sentinel', 'check', '--'], taskIdRequired: true },
    guard: { directCommands: { npmScripts: ['test'], npxTools: [], cargoSubcommands: [], tools: [] } },
  };
}

suite('Sentinel core diagnose (orquestador agnóstico)', () => {
  test('detecta política v2 con hash, lock y scheduler', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-diagnose-v2-'));
    const previous = process.env.CARGO_TARGET_DIR_BASE;
    process.env.CARGO_TARGET_DIR_BASE = path.join(root, 'target-base');
    try {
      fs.writeFileSync(path.join(root, 'sentinel.config.json'), JSON.stringify(policy()), 'utf8');
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
      assert.strictEqual(result.ready, true);
      assert.match(formatStatus(result), /no-policy/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('bloquea readiness cuando faltan source checkout y CLI compilado', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-diagnose-preflight-'));
    try {
      fs.writeFileSync(path.join(root, 'sentinel.config.json'), JSON.stringify(policy()), 'utf8');
      fs.writeFileSync(path.join(root, 'quality-tools.json'), JSON.stringify({
        schemaVersion: 1,
        tools: {
          sentinel: {
            sourcePath: 'tools/sentinel',
            commit: 'a'.repeat(40),
            cli: 'out/cli/index.js',
          },
        },
      }), 'utf8');
      fs.writeFileSync(path.join(root, 'sentinel.lock.json'), JSON.stringify({
        schemaVersion: 1,
        analyzers: { sentinel: { commit: 'b'.repeat(40) } },
      }), 'utf8');
      const result = await diagnoseWorkspace(root);
      assert.strictEqual(result.ready, false);
      assert.ok(result.issues.some(issue => issue.code === 'tool-source-missing'));
      assert.ok(result.issues.some(issue => issue.code === 'tool-cli-missing'));
      assert.ok(result.issues.some(issue => issue.code === 'tool-lock-mismatch'));
      assert.match(formatDiagnose(result), /Preflight: BLOQUEADO/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
