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
