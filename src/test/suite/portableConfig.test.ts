import * as assert from 'assert';
import { DEFAULT_INCLUDE_PATTERNS, buildCoreConfig, patronesDeInclusion, validateSentinelConfig } from '../../core/config';

suite('Portable boundary config', () => {
  test('accepts boundary arrays and maps them to core config', () => {
    const input = { portableBoundaries: { dom: ['/platform/'], services: ['/services/'] } };
    validateSentinelConfig(input);
    const config = buildCoreConfig(input);
    assert.deepStrictEqual(config.portableBoundaries, input.portableBoundaries);
  });

  test('rejects unknown portable boundary keys', () => {
    assert.throws(() => validateSentinelConfig({ portableBoundaries: { unknown: [] } }), /clave desconocida/);
  });
});

/* [17AA-4] Antes `includePatterns` reemplazaba los defaults, asi que una ficha
 * que declaraba los suyos congelaba una copia de los defaults de su fecha: al
 * ganar el default del `.mjs`, las 11 fichas con patrones propios siguieron sin
 * analizarlo. Ahora se unen. */
suite('includePatterns se une a los defaults [17AA-4]', () => {
  test('sin patrones propios, los defaults tal cual', () => {
    assert.deepStrictEqual(patronesDeInclusion(undefined), DEFAULT_INCLUDE_PATTERNS);
    assert.deepStrictEqual(buildCoreConfig({}).includePatterns, DEFAULT_INCLUDE_PATTERNS);
  });

  test('con patrones propios, la union: el default nuevo llega igual', () => {
    const unidos = patronesDeInclusion(['**/*.ts', '**/*.tsx']);
    for (const patron of DEFAULT_INCLUDE_PATTERNS) {
      assert.ok(unidos.includes(patron), `falta el default ${patron}`);
    }
    assert.ok(unidos.includes('**/*.mjs'), 'el default de .mjs tiene que llegar a la ficha');
    assert.ok(unidos.includes('**/*.tsx'), 'y lo que declara la ficha se conserva');
  });

  test('acotar a un subdirectorio sigue funcionando', () => {
    const config = buildCoreConfig({ includePatterns: ['frontend/**/*.ts'] });
    assert.ok(config.includePatterns.includes('frontend/**/*.ts'));
    assert.ok(config.includePatterns.includes('**/*.mjs'), 'el acotado no impide el default');
  });

  test('no duplica si la ficha ya repite un default', () => {
    const unidos = patronesDeInclusion(['**/*.mjs', '**/*.ts']);
    assert.strictEqual(unidos.length, new Set(unidos).size);
    assert.strictEqual(unidos.filter(p => p === '**/*.mjs').length, 1);
  });

  test('una lista vacia equivale a no declarar nada', () => {
    assert.deepStrictEqual(patronesDeInclusion([]), DEFAULT_INCLUDE_PATTERNS);
  });
});

suite('Heavy budget config [07AA-10]', () => {
  test('accepts a well-formed budgets policy', () => {
    validateSentinelConfig({ budgets: { mode: 'enforce', limits: { 'cargo-check': 2 } } });
    validateSentinelConfig({ budgets: {} });
  });

  test('rejects unknown top-level budgets shapes fail-closed', () => {
    assert.throws(() => validateSentinelConfig({ budgets: 'yes' }), /'budgets' debe ser un objeto/);
    assert.throws(() => validateSentinelConfig({ budgets: { mode: 'sometimes' } }), /budgets\.mode/);
    assert.throws(() => validateSentinelConfig({ budgets: { limits: { 'cargo-chek': 2 } } }), /clase de límite desconocida/);
    assert.throws(() => validateSentinelConfig({ budgets: { limits: { 'cargo-check': 101 } } }), /límite inválido/);
    assert.throws(() => validateSentinelConfig({ budgets: { limits: { 'cargo-check': 1.5 } } }), /límite inválido/);
  });
});
