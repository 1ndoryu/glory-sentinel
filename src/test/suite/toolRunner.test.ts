/* [028A-6 Fase 1] Tests del runner de procesos (extraído de
 * scripts/quality/runner.mjs): env allowlist, captura acotada, timeout y
 * cancelación. */
import * as assert from 'assert';
import { cancelAll, runProcess, safeEnvironment } from '../../core/toolRunner';

suite('Sentinel core tool runner (orquestador agnóstico)', () => {
  test('env allowlist conserva solo claves del proyecto y extras', () => {
    const env = safeEnvironment({ CUSTOM_EXTRA: 'x' });
    assert.strictEqual(env.CUSTOM_EXTRA, 'x');
    assert.ok(!('NODE_OPTIONS' in env));
    if (process.env.PATH !== undefined) assert.strictEqual(env.PATH, process.env.PATH);
  });

  test('runProcess captura salida y código', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("ok")']);
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, 'ok');
    assert.strictEqual(result.stderr, '');
    assert.strictEqual(result.timedOut, false);
    assert.strictEqual(result.cancelled, false);
  });

  test('runProcess conserva exit codes no estándar', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.exit(7)']);
    assert.strictEqual(result.code, 7);
  });

  test('timeout termina el proceso y marca timedOut', async () => {
    const result = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 50 });
    assert.strictEqual(result.timedOut, true);
    assert.strictEqual(result.code, 2);
  });

  test('cancelación inicial resuelve como cancelado sin ejecutar', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.exit(0)'], { isCancelled: () => true });
    assert.strictEqual(result.cancelled, true);
    assert.strictEqual(result.code, 130);
    assert.strictEqual(result.durationMs, 0);
  });

  test('captura se trunca en 64 KiB con marcador visible', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(200000))']);
    assert.ok(result.stdout.includes('truncated at'), 'debe conservar el marcador de truncado');
    assert.ok(result.stdout.length < 200_000, 'no puede acumular la salida completa');
  });

  test('ejecutable inexistente produce error tool', async () => {
    const result = await runProcess('nonexistent-tool-xyz-123', []);
    assert.strictEqual(result.code, 2);
    assert.ok(result.stderr.length > 0);
  });

  test('cancelAll no lanza sin procesos activos', () => {
    cancelAll();
    assert.ok(true);
  });
});
