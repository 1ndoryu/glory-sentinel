import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadStageManifest } from '../../core/stageManifest';

function fixtureRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-stage-manifest-')); }
function stage(name: string, reportPath = 'nested/report.json', cwd = '.'): object {
  return { name, executable: process.execPath, args: ['-e', 'write', '{reportPath}'], reportPath, expectedSchemaVersion: '1', timeoutMs: 1000, cwd };
}
function skipWindowsSymlink(error: unknown): boolean {
  return process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM';
}

suite('Sentinel stage manifest contract', () => {
  test('loads versioned envelope and resolves nested report path', async () => {
    const root = fixtureRoot();
    try {
      const manifestPath = path.join(root, 'stages.json');
      const reportRoot = path.join(root, '.reports');
      fs.mkdirSync(reportRoot);
      fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, stages: [stage('node')] }));
      const loaded = await loadStageManifest(manifestPath, root, reportRoot);
      assert.strictEqual(loaded.schemaVersion, 1);
      assert.strictEqual(loaded.stages[0].name, 'node');
      assert.strictEqual(loaded.stages[0].reportPath, path.join(reportRoot, 'nested', 'report.json'));
      assert.ok(loaded.stages[0].args.some(arg => arg.includes(path.join(reportRoot, 'nested', 'report.json'))));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('accepts legacy raw arrays, including an empty array, while normalizing to schema 1', async () => {
    const root = fixtureRoot();
    try {
      const reportRoot = path.join(root, '.reports');
      fs.mkdirSync(reportRoot);
      const manifestPath = path.join(root, 'legacy.json');
      fs.writeFileSync(manifestPath, JSON.stringify([stage('legacy')]));
      const loaded = await loadStageManifest(manifestPath, root, reportRoot);
      assert.strictEqual(loaded.schemaVersion, 1);
      assert.strictEqual(loaded.stages[0].name, 'legacy');
      const emptyPath = path.join(root, 'empty.json');
      fs.writeFileSync(emptyPath, '[]');
      const empty = await loadStageManifest(emptyPath, root, reportRoot);
      assert.deepStrictEqual(empty, { schemaVersion: 1, stages: [] });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('rejects unknown keys, duplicate names, invalid timeout and traversal', async () => {
    const root = fixtureRoot();
    try {
      const reportRoot = path.join(root, '.reports');
      fs.mkdirSync(reportRoot);
      const cases: Array<[string, object, RegExp]> = [
        ['unknown', { schemaVersion: 1, stages: [{ ...stage('x'), typo: true }] }, /clave desconocida/],
        ['duplicate', { schemaVersion: 1, stages: [stage('x'), stage('x')] }, /duplicada/],
        ['timeout', { schemaVersion: 1, stages: [{ ...stage('x'), timeoutMs: 30 * 60 * 1000 + 1 }] }, /timeoutMs/],
        ['traversal', { schemaVersion: 1, stages: [{ ...stage('x'), reportPath: '../escape.json' }] }, /fuera/],
      ];
      for (const [name, payload, expected] of cases) {
        const manifestPath = path.join(root, `${name}.json`);
        fs.writeFileSync(manifestPath, JSON.stringify(payload));
        await assert.rejects(loadStageManifest(manifestPath, root, reportRoot), expected);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('rejects a manifest symlink that escapes the workspace', async () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    try {
      const reportRoot = path.join(root, '.reports');
      fs.mkdirSync(reportRoot);
      const outsideManifest = path.join(outside, 'outside.json');
      fs.writeFileSync(outsideManifest, JSON.stringify({ schemaVersion: 1, stages: [stage('outside')] }));
      const link = path.join(root, 'stages-link.json');
      try { fs.symlinkSync(outsideManifest, link, 'file'); }
      catch (error) { if (skipWindowsSymlink(error)) return; throw error; }
      await assert.rejects(loadStageManifest(link, root, reportRoot), /fuera|simbólico/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('rejects reportRoot, cwd and reportPath symlink escapes', async () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    try {
      const safeReportRoot = path.join(root, '.reports');
      fs.mkdirSync(safeReportRoot);
      const outsideDir = path.join(outside, 'outside-dir');
      fs.mkdirSync(outsideDir);
      const reportLink = path.join(root, 'report-link');
      const cwdLink = path.join(root, 'cwd-link');
      const reportPathLink = path.join(safeReportRoot, 'report-link.json');
      try {
        fs.symlinkSync(outsideDir, reportLink, 'junction');
        fs.symlinkSync(outsideDir, cwdLink, 'junction');
        fs.symlinkSync(path.join(outside, 'outside.json'), reportPathLink, 'file');
      } catch (error) {
        if (skipWindowsSymlink(error)) return;
        throw error;
      }
      const manifestReportRoot = path.join(root, 'report-root.json');
      fs.writeFileSync(manifestReportRoot, JSON.stringify({ schemaVersion: 1, stages: [stage('report-root')] }));
      await assert.rejects(loadStageManifest(manifestReportRoot, root, reportLink), /fuera|symlink|junction/);
      const manifestCwd = path.join(root, 'cwd.json');
      fs.writeFileSync(manifestCwd, JSON.stringify({ schemaVersion: 1, stages: [stage('cwd', 'cwd.json', 'cwd-link')] }));
      await assert.rejects(loadStageManifest(manifestCwd, root, safeReportRoot), /fuera|symlink|junction/);
      const manifestReportPath = path.join(root, 'report-path.json');
      fs.writeFileSync(manifestReportPath, JSON.stringify({ schemaVersion: 1, stages: [stage('report-path', 'report-link.json')] }));
      await assert.rejects(loadStageManifest(manifestReportPath, root, safeReportRoot), /fuera|symlink|junction/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
