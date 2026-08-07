/* [028A-6 Fase 1/SNT-16d] Tests del diagnóstico de `sentinel doctor`/`status`.
 * El doctor es solo lectura y debe identificar prerequisitos faltantes antes
 * de que un gate falle a mitad de ejecución. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { diagnoseWorkspace, formatDiagnose, formatStatus } from '../../core/diagnose';
import { runCli } from '../../cli/index';

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

  test('declara capacidad ausente, dependencias no provisionadas y package-lock sucio antes del gate', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-diagnose-capabilities-'));
    const source = path.join(root, 'tools', 'sentinel');
    try {
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(root, 'quality.config.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(root, 'sentinel.config.json'), JSON.stringify(policy()), 'utf8');
      fs.writeFileSync(path.join(root, 'quality-tools.json'), JSON.stringify({
        schemaVersion: 1,
        tools: { sentinel: { sourcePath: 'tools/sentinel', commit: 'a'.repeat(40), version: '0.5.0', buildScript: 'compile', cli: 'out/cli/index.js' } },
      }), 'utf8');
      fs.writeFileSync(path.join(root, 'sentinel.lock.json'), JSON.stringify({ schemaVersion: 1, analyzers: { sentinel: { commit: 'a'.repeat(40) } } }), 'utf8');
      fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ scripts: { compile: 'tsc' } }), 'utf8');
      fs.writeFileSync(path.join(source, 'package-lock.json'), '{}', 'utf8');
      fs.mkdirSync(path.join(source, 'out', 'cli'), { recursive: true });
      fs.writeFileSync(path.join(source, 'out', 'cli', 'index.js'), '#!/usr/bin/env node\nif (process.argv.includes(\'--version\')) console.log(\'0.5.0\'); else if (process.argv.includes(\'--help\')) console.log(\'analyze\');\n', 'utf8');
      fs.mkdirSync(path.join(source, 'node_modules'), { recursive: true });
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 'sentinel@example.test'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 'Sentinel Test'], { cwd: root });
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: root });
      fs.appendFileSync(path.join(source, 'package-lock.json'), '\n{"interrupted":true}\n', 'utf8');
      const result = await diagnoseWorkspace(root);
      assert.strictEqual(result.ready, false);
      const tool = result.tools.sentinel;
      assert.ok(tool);
      assert.deepStrictEqual(tool.missingCapabilities, ['guard', 'doctor', 'task', 'recover']);
      assert.ok(result.issues.some(issue => issue.code === 'tool-capability-missing'));
      assert.ok(result.issues.some(issue => issue.code === 'tool-release-unpublished'));
      assert.ok(result.issues.some(issue => issue.code === 'tool-release-evidence-missing'));
      assert.ok(result.issues.some(issue => issue.code === 'tool-package-lock-dirty'));
      assert.strictEqual(tool.packageLockPresent, true);
      assert.strictEqual(await runCli(['doctor', '--workspace', root, '--json']), 1);
      assert.strictEqual(tool.dependenciesPresent, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rechaza sourcePath que escapa por junction aunque la ruta léxica esté dentro', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-diagnose-escape-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-diagnose-outside-'));
    try {
      fs.writeFileSync(path.join(root, 'sentinel.config.json'), JSON.stringify(policy()), 'utf8');
      fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
      fs.symlinkSync(outside, path.join(root, 'tools', 'sentinel'), 'junction');
      fs.writeFileSync(path.join(root, 'quality-tools.json'), JSON.stringify({
        schemaVersion: 1,
        tools: { sentinel: { sourcePath: 'tools/sentinel', commit: 'a'.repeat(40), cli: 'out/cli/index.js' } },
      }), 'utf8');
      fs.writeFileSync(path.join(root, 'sentinel.lock.json'), JSON.stringify({ schemaVersion: 1, analyzers: { sentinel: { commit: 'a'.repeat(40) } } }), 'utf8');
      const result = await diagnoseWorkspace(root);
      assert.strictEqual(result.ready, false);
      assert.ok(result.issues.some(issue => issue.code === 'tool-source-escape'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
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
