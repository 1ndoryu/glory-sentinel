import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { runCheck } from '../../core/gateRun';

function gitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-gate-envelope-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'base.ts'), 'export const a = 1;\n');
  execFileSync('git', ['add', 'base.ts'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: root });
  return root;
}

function stage(reportPath = 'nested/probe.json'): object {
  return {
    name: 'probe',
    executable: process.execPath,
    args: ['-e', "require('fs').writeFileSync(process.argv[1], JSON.stringify({schemaVersion:1,entries:[{ruta:'src/index.js',findings:[{ruleId:'fixture-rule',severity:'error',line:7,message:'fixture finding'}]}]}))", '{reportPath}'],
    reportPath,
    expectedSchemaVersion: '1',
    timeoutMs: 10000,
    cwd: '.',
  };
}

function comparable(report: { decision?: { label?: string }; stages?: Array<{ stage?: string; status?: string; findings?: unknown[] }> }): unknown {
  return {
    decision: report.decision?.label,
    stages: (report.stages ?? []).map(stageResult => ({ stage: stageResult.stage, status: stageResult.status, findings: stageResult.findings })),
  };
}

suite('Sentinel gate with stage manifest envelope', () => {
  test('executes envelope and creates nested report output', async () => {
    const root = gitRepo();
    try {
      const stagesPath = path.join(root, 'stages.json');
      fs.writeFileSync(stagesPath, JSON.stringify({ schemaVersion: 1, stages: [stage()] }));
      const reportRoot = path.join(root, '.quality-reports', 'check');
      const result = await runCheck({ workspace: root, reportRoot, dryRun: false, taskId: 'SNT-16C', stagesPath });
      assert.strictEqual(result.exitCode, 1);
      assert.ok(fs.existsSync(path.join(reportRoot, 'nested', 'probe.json')));
      const report = JSON.parse(fs.readFileSync(path.join(reportRoot, 'latest.json'), 'utf8'));
      assert.strictEqual(report.stages[0].status, 'fail');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('envelope y lista legacy producen la misma decisión y findings', async () => {
    const root = gitRepo();
    try {
      const envelopePath = path.join(root, 'envelope.json');
      const legacyPath = path.join(root, 'legacy.json');
      const declaration = stage();
      fs.writeFileSync(envelopePath, JSON.stringify({ schemaVersion: 1, stages: [declaration] }));
      fs.writeFileSync(legacyPath, JSON.stringify([declaration]));
      const envelopeRoot = path.join(root, '.quality-reports', 'envelope');
      const legacyRoot = path.join(root, '.quality-reports', 'legacy');
      const envelopeResult = await runCheck({ workspace: root, reportRoot: envelopeRoot, dryRun: false, taskId: 'SNT-16C-ENV', stagesPath: envelopePath });
      const legacyResult = await runCheck({ workspace: root, reportRoot: legacyRoot, dryRun: false, taskId: 'SNT-16C-LEG', stagesPath: legacyPath });
      const envelopeReport = JSON.parse(fs.readFileSync(path.join(envelopeRoot, 'latest.json'), 'utf8'));
      const legacyReport = JSON.parse(fs.readFileSync(path.join(legacyRoot, 'latest.json'), 'utf8'));
      assert.strictEqual(envelopeResult.exitCode, legacyResult.exitCode);
      assert.deepStrictEqual(comparable(envelopeReport), comparable(legacyReport));
      assert.deepStrictEqual(comparable(envelopeReport), {
        decision: 'FAIL',
        stages: [{ stage: 'probe', status: 'fail', findings: [{ ruleId: 'fixture-rule', severity: 'error', file: 'src/index.js', line: 7, message: 'fixture finding' }] }],
      });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
