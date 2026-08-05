/* [028A-6 Fase 1] Tests del fingerprint de etapas (extraído de
 * scripts/quality/tests/cache.test.mjs): un PASS no cruza modos, cambios de
 * archivo ni formato. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  fingerprint,
  readCachedPass,
  writeCachedPass,
  StageCacheContext,
  StageCacheScope,
} from '../../core/stageCache';

function baseContext(projectRoot: string): StageCacheContext {
  return {
    projectRoot,
    qualityConfig: { schemaVersion: 1, lockWaitMs: 0 },
    toolManifest: { schemaVersion: 1, tools: {} },
    policy: { policyHash: 'policy-a' },
    lock: { schemaVersion: 1, analyzers: { sentinel: { sha256: 'lock-a' } } },
  };
}

suite('Sentinel core stage cache (orquestador agnóstico)', () => {
  test('cache distingue pass, cambios de archivo y formato', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-stage-cache-'));
    try {
      fs.writeFileSync(path.join(projectRoot, 'input.ts'), 'export const value = 1;\n', 'utf8');
      const context = baseContext(projectRoot);
      const scope = { files: ['input.ts'], fingerprintFiles: ['input.ts'] };
      const first = await fingerprint(context, scope, 'frontend');
      await writeCachedPass(context, 'frontend', first, { status: 'pass', durationMs: 3 });
      const cached = await readCachedPass(context, 'frontend', first);
      assert.strictEqual(cached?.cached, true);
      assert.strictEqual(cached?.status, 'pass');

      fs.writeFileSync(path.join(projectRoot, 'input.ts'), 'export const value = 2;\n', 'utf8');
      const second = await fingerprint(context, scope, 'frontend');
      assert.notStrictEqual(second, first);
      assert.strictEqual(await readCachedPass(context, 'frontend', second), null);
      assert.match(
        fs.readFileSync(path.join(projectRoot, '.quality-reports', 'cache', 'frontend.json'), 'utf8'),
        /fingerprint/,
      );
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('cache separa el modo local del gate CI', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-stage-cache-mode-'));
    try {
      fs.writeFileSync(path.join(projectRoot, 'input.ts'), 'export const value = 1;\n', 'utf8');
      const base = baseContext(projectRoot);
      const scope = { files: ['input.ts'], fingerprintFiles: ['input.ts'] };
      const local = await fingerprint({ ...base, ci: false, full: false }, scope, 'frontend');
      const full = await fingerprint({ ...base, ci: false, full: true }, scope, 'frontend');
      const ci = await fingerprint({ ...base, ci: true, full: false }, scope, 'frontend');
      assert.notStrictEqual(local, full);
      assert.notStrictEqual(local, ci);
      const changedPolicy = await fingerprint({ ...base, policy: { policyHash: 'policy-b' } }, scope, 'frontend');
      assert.notStrictEqual(local, changedPolicy);
      const changedLock = await fingerprint(
        { ...base, lock: { schemaVersion: 1, analyzers: { sentinel: { sha256: 'lock-b' } } } },
        scope,
        'frontend',
      );
      assert.notStrictEqual(local, changedLock);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('cache usa el alcance efectivo del guard, no solo context.full (028A-8)', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-stage-cache-effective-'));
    try {
      fs.writeFileSync(path.join(projectRoot, 'input.ts'), 'export const value = 1;\n', 'utf8');
      const base = baseContext(projectRoot);
      const scope = { files: ['input.ts'], fingerprintFiles: ['input.ts'] };
      /* AutomaticFull permitido: context.full=false pero effectiveFull=true. */
      const automaticFull = await fingerprint(
        { ...base, ci: false, full: false },
        { ...scope, effectiveFull: true },
        'frontend',
      );
      const plainLocal = await fingerprint(
        { ...base, ci: false, full: false },
        { ...scope, effectiveFull: false },
        'frontend',
      );
      assert.notStrictEqual(automaticFull, plainLocal, 'un automaticFull no puede reutilizar un PASS local-light');
      /* Full diferido: context.full=false y effectiveFull=false coinciden en
       * local-light y no contaminan el fingerprint de un full permitido. */
      const deferred = await fingerprint(
        { ...base, ci: false, full: false },
        { ...scope, effectiveFull: false, requestedFull: true } as StageCacheScope,
        'frontend',
      );
      assert.strictEqual(deferred, plainLocal);
      assert.notStrictEqual(deferred, automaticFull);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
