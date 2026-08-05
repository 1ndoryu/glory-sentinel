/* [028A-6 Fase 1] Tests del runner de etapas (extraído de
 * scripts/quality/tests/stage-runner.test.mjs): orden, concurrencia y
 * drenaje ante error/cancelación. */
import * as assert from 'assert';
import { runBoundedStages } from '../../core/stageRunner';

suite('Sentinel core stage runner (orquestador agnóstico)', () => {
  test('conserva orden y respeta concurrencia', async () => {
    let active = 0;
    let maximum = 0;
    const results = await runBoundedStages([1, 2, 3, 4], async value => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 3));
      active -= 1;
      return Number(value) * 2;
    }, { maxConcurrency: 2 });
    assert.deepStrictEqual(results, [2, 4, 6, 8]);
    assert.strictEqual(maximum, 2);
  });

  test('cancela antes de iniciar trabajo nuevo', async () => {
    await assert.rejects(
      runBoundedStages([1], async () => 1, { isCancelled: () => true }),
      /cancelado/,
    );
  });

  test('drena etapas activas y no agenda nuevas al cancelar', async () => {
    let active = 0;
    let maximum = 0;
    let started = 0;
    let settled = 0;
    let cancelled = false;
    const cancellation = new Promise<void>(resolve => setTimeout(() => {
      cancelled = true;
      resolve();
    }, 5));
    const runStage = async (value: number) => {
      started += 1;
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 25));
      active -= 1;
      settled += 1;
      return value;
    };
    await assert.rejects(
      Promise.all([
        runBoundedStages([1, 2, 3, 4], runStage, { maxConcurrency: 2, isCancelled: () => cancelled }),
        cancellation,
      ]).then(([results]) => results),
      /cancelado/,
    );
    assert.strictEqual(maximum, 2);
    assert.strictEqual(started, 2);
    assert.strictEqual(settled, 2);
    assert.strictEqual(active, 0);
  });

  test('drena el worker paralelo tras un error', async () => {
    let settled = 0;
    const runStage = async (value: number) => {
      await new Promise(resolve => setTimeout(resolve, value === 1 ? 5 : 25));
      settled += 1;
      if (value === 1) throw new Error('stage fixture failed');
      return value;
    };
    await assert.rejects(
      runBoundedStages([1, 2, 3], runStage, { maxConcurrency: 2 }),
      /stage fixture failed/,
    );
    assert.strictEqual(settled, 2);
  });
});
