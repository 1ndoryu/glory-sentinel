import * as assert from 'assert';
import { buildCoreConfig, validateSentinelConfig } from '../../core/config';

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
