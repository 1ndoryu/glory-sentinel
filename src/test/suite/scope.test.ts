/* [028A-6 Fase 1] Tests del core de alcance agnóstico (extraído del
 * orquestador scripts/quality). La matriz de decisión y los globs deben
 * permanecer deterministas para que la migración del gate no cambie resultados. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  detectScope,
  expandLocalDependencies,
  matches,
  resolveExplicitProfiles,
  resolveFullDecision,
} from '../../core/scope';

suite('Sentinel core scope (orquestador agnóstico)', () => {
  test('scope usa globs deterministas y normaliza separadores', () => {
    assert.strictEqual(matches('frontend/src/router.ts', 'frontend/**/*.ts'), true);
    assert.strictEqual(matches('frontend/router.ts', 'frontend/**/*.ts'), true);
    assert.strictEqual(matches('frontend/src/router.test.ts', 'frontend/**/*.css'), false);
    assert.strictEqual(matches('src/styles/app.css', '.css'), true);
    assert.strictEqual(matches('scripts/quality/cache.mjs', 'scripts/quality/'), true);
    assert.strictEqual(matches('frontend/src/router.ts', 'backend/**/*.ts'), false);
    assert.strictEqual(matches('frontend\\src\\router.ts', 'frontend/**/*.ts'), true);
  });

  test('resolveExplicitProfiles aplica CLI sobre entorno y allowlist estricta', () => {
    const available = { docs: ['.md'], rust: ['.rs'] };
    const cli = resolveExplicitProfiles({ profiles: ['docs'] }, available, {
      GLORY_QUALITY_PROFILE: 'rust',
    });
    assert.strictEqual(cli.explicit, true);
    assert.strictEqual(cli.source, 'cli');
    assert.deepEqual([...cli.profiles], ['docs']);

    const env = resolveExplicitProfiles({ profiles: [] }, available, {
      GLORY_QUALITY_PROFILE: 'rust,docs,rust',
    });
    assert.strictEqual(env.source, 'env');
    assert.deepEqual([...env.profiles], ['rust', 'docs']);
    assert.throws(
      () => resolveExplicitProfiles({ profiles: ['unknown'] }, available, {}),
      /Perfil no permitido: unknown/,
    );
    assert.throws(
      () => resolveExplicitProfiles({ profiles: ['auth'] }, { ...available, auth: ['auth'] }, {}),
      /Perfil sin etapa ejecutable: auth/,
    );
  });

  test('scope incluye dependencias locales en el fingerprint incremental', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-scope-dep-'));
    try {
      fs.writeFileSync(path.join(root, 'entry.ts'), "import { value } from './dependency';\nexport { value };\n", 'utf8');
      fs.writeFileSync(path.join(root, 'dependency.ts'), 'export const value = 1;\n', 'utf8');
      assert.deepEqual(await expandLocalDependencies(root, ['entry.ts']), ['dependency.ts', 'entry.ts']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('resolveFullDecision separa requested/automatic/deferred/effective', () => {
    assert.deepEqual(
      resolveFullDecision({ requested: true, automatic: false, deferred: false, explicit: false }),
      { full: true, effectiveFull: true, executionFull: true },
    );
    assert.deepEqual(
      resolveFullDecision({ requested: false, automatic: true, deferred: false, explicit: false }),
      { full: true, effectiveFull: true, executionFull: true },
    );
    assert.deepEqual(
      resolveFullDecision({ requested: true, automatic: true, deferred: true, explicit: false }),
      { full: true, effectiveFull: false, executionFull: false },
    );
    assert.deepEqual(
      resolveFullDecision({ requested: true, automatic: false, deferred: false, explicit: true }),
      { full: true, effectiveFull: true, executionFull: false },
    );
    assert.deepEqual(
      resolveFullDecision({ requested: false, automatic: false, deferred: false, explicit: false }),
      { full: false, effectiveFull: false, executionFull: false },
    );
  });

  test('detectScope calcula el alcance real desde git', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-scope-git-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
      fs.writeFileSync(path.join(root, 'base.ts'), 'export const a = 1;\n', 'utf8');
      execFileSync('git', ['add', 'base.ts'], { cwd: root });
      execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: root });
      fs.writeFileSync(path.join(root, 'new.ts'), 'export const b = 2;\n', 'utf8');

      const reportRoot = path.join(root, '.quality-reports', 'check');
      fs.mkdirSync(reportRoot, { recursive: true });
      const result = await detectScope(
        { projectRoot: root, reportRoot, qualityConfig: { fullPatterns: [], profiles: {} } },
        {},
      );
      assert.deepEqual(result.files, ['new.ts']);
      assert.strictEqual(result.automaticFull, false);
      assert.strictEqual(result.effectiveFull, false);
      assert.strictEqual(result.fullReason, 'incremental');
      assert.ok(fs.existsSync(path.join(reportRoot, 'changed-files.txt')));
      assert.ok(fs.existsSync(path.join(reportRoot, 'scope-manifest.json')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
