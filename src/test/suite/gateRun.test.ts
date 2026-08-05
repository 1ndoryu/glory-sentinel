/* [028A-6 Fase 1] Tests de la orquestación del gate (runCheck): dry-run,
 * ejecución real con etapas declarativas, fallo por finding error y stages
 * malformados. Repos git reales temporales. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { runCheck } from '../../core/gateRun';

function gitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-gaterun-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'base.ts'), 'export const a = 1;\n', 'utf8');
  execFileSync('git', ['add', 'base.ts'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: root });
  return root;
}

function passStage(): object {
  return {
    name: 'probe',
    executable: process.execPath,
    args: ['-e', "require('fs').writeFileSync(process.argv[1], JSON.stringify({schemaVersion:1,entries:[]}))", '{reportPath}'],
    expectedSchemaVersion: '1',
    timeoutMs: 10000,
  };
}

suite('Sentinel core gate run (orquestador agnóstico)', () => {
  test('dry-run calcula el alcance sin ejecutar etapas', async () => {
    const root = gitRepo();
    try {
      const result = await runCheck({
        workspace: root,
        reportRoot: path.join(root, '.quality-reports', 'check-dry-run'),
        dryRun: true,
        taskId: 'DRY-1',
      });
      assert.strictEqual(result.exitCode, 0);
      const parsed = JSON.parse(result.output);
      assert.ok(Array.isArray(parsed.files));
      assert.strictEqual(parsed.taskId, 'DRY-1');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('real-run ejecuta etapas declarativas y produce PASS', async () => {
    const root = gitRepo();
    try {
      const stagesPath = path.join(root, 'stages.json');
      fs.writeFileSync(stagesPath, JSON.stringify([passStage()]), 'utf8');
      const reportRoot = path.join(root, '.quality-reports', 'check', 'RUN-1');
      const result = await runCheck({
        workspace: root,
        reportRoot,
        dryRun: false,
        taskId: 'RUN-1',
        stagesPath,
      });
      assert.strictEqual(result.exitCode, 0);
      assert.match(result.output, /PASS/);
      assert.ok(fs.existsSync(path.join(reportRoot, 'latest.json')));
      const report = JSON.parse(fs.readFileSync(path.join(reportRoot, 'latest.json'), 'utf8'));
      assert.strictEqual(report.stages[0].stage, 'probe');
      assert.strictEqual(report.stages[0].status, 'pass');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('real-run con finding error produce FAIL y exit 1', async () => {
    const root = gitRepo();
    try {
      const stagesPath = path.join(root, 'stages-fail.json');
      fs.writeFileSync(stagesPath, JSON.stringify([{
        name: 'fail-probe',
        executable: process.execPath,
        args: ['-e', "require('fs').writeFileSync(process.argv[1], JSON.stringify({schemaVersion:1,entries:[{findings:[{ruleId:'demo',severity:'error',message:'boom'}]}]}))", '{reportPath}'],
        expectedSchemaVersion: '1',
        timeoutMs: 10000,
      }]), 'utf8');
      const result = await runCheck({
        workspace: root,
        reportRoot: path.join(root, '.quality-reports', 'check', 'RUN-2'),
        dryRun: false,
        taskId: 'RUN-2',
        stagesPath,
      });
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /FAIL/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('stages con timeoutMs inválido fallan cerrado', async () => {
    const root = gitRepo();
    try {
      const stagesPath = path.join(root, 'stages-bad.json');
      fs.writeFileSync(stagesPath, JSON.stringify([{
        name: 'bad',
        executable: process.execPath,
        args: [],
        timeoutMs: 'abc',
      }]), 'utf8');
      await assert.rejects(
        runCheck({
          workspace: root,
          reportRoot: path.join(root, '.quality-reports', 'check', 'RUN-3'),
          dryRun: false,
          taskId: 'RUN-3',
          stagesPath,
        }),
        /timeoutMs inválido/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
