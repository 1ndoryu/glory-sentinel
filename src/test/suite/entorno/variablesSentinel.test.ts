/* [S-R1] Tests de los nombres SENTINEL_* y de su alias GLORY_QUALITY_*:
 * precedencia del canónico, lectura del alias y restauración del entorno. */
import * as assert from 'assert';
import { fijarEntornoSentinel, leerEntornoSentinel } from '../../../core/entorno/variablesSentinel';

suite('Variables de entorno SENTINEL_* (alias GLORY_QUALITY_*)', () => {
  test('el nombre canónico gana sobre el alias', () => {
    const env = { SENTINEL_PROFILE: 'docs', GLORY_QUALITY_PROFILE: 'rust' } as NodeJS.ProcessEnv;
    assert.strictEqual(leerEntornoSentinel(env, 'SENTINEL_PROFILE'), 'docs');
  });

  test('el alias GLORY_QUALITY_* sigue funcionando si falta el canónico', () => {
    const env = { GLORY_QUALITY_ALLOW_HEAVY: '1' } as NodeJS.ProcessEnv;
    assert.strictEqual(leerEntornoSentinel(env, 'SENTINEL_ALLOW_HEAVY'), '1');
  });

  test('sin ninguno de los dos nombres devuelve undefined', () => {
    assert.strictEqual(leerEntornoSentinel({} as NodeJS.ProcessEnv, 'SENTINEL_GATE_TOKEN'), undefined);
  });

  test('fijar escribe ambos nombres y la restauración deja el entorno intacto', () => {
    const env = { GLORY_QUALITY_GATE_TOKEN: 'previo' } as NodeJS.ProcessEnv;
    const restaurar = fijarEntornoSentinel(env, 'SENTINEL_GATE_TOKEN', 'nuevo');
    assert.strictEqual(env.SENTINEL_GATE_TOKEN, 'nuevo');
    assert.strictEqual(env.GLORY_QUALITY_GATE_TOKEN, 'nuevo');
    restaurar();
    assert.strictEqual(env.SENTINEL_GATE_TOKEN, undefined);
    assert.strictEqual(env.GLORY_QUALITY_GATE_TOKEN, 'previo');
  });
});
