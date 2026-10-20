/* [marcadores] Los marcadores del framework Glory salen de la config del proyecto y vuelven al defecto sin ella. */
import * as assert from 'assert';
import { buildCoreConfig, validateSentinelConfig } from '../../../core/runtime-proyecto/config';
import { esRutaGlory } from '../../../utils/analisis/rutasYContenido';
import { resolverAjustesProyecto } from '../../../analyzers/ajustesProyecto';

suite('marcadoresGlory', () => {
  test('por defecto reconoce /Glory/ y /glory-core/', () => {
    assert.strictEqual(esRutaGlory('C:/repo/Glory/Modal.tsx'), true);
    assert.strictEqual(esRutaGlory('C:/repo/frontend/src/glory-core/Boton.tsx'), true);
    assert.strictEqual(esRutaGlory('C:/repo/src/panel.tsx'), false);
  });

  test('con marcadores propios sustituye a los de defecto', () => {
    const marcadores = resolverAjustesProyecto({ marcadoresGlory: ['/Framework/'] }).marcadoresGlory;
    assert.strictEqual(esRutaGlory('C:\\repo\\Framework\\Modal.tsx', marcadores), true);
    assert.strictEqual(esRutaGlory('C:/repo/Glory/Modal.tsx', marcadores), false);
  });

  test('una lista vacia vuelve al defecto', () => {
    const marcadores = resolverAjustesProyecto({ marcadoresGlory: [] }).marcadoresGlory;
    assert.strictEqual(esRutaGlory('C:/repo/Glory/Modal.tsx', marcadores), true);
  });

  test('buildCoreConfig toma marcadoresGlory de la subconfig v2 y v1', () => {
    const v2 = buildCoreConfig({ schemaVersion: 2, analyzers: { sentinel: { config: { marcadoresGlory: ['/Framework/'] } } } });
    const v1 = buildCoreConfig({ marcadoresGlory: ['/Framework/'] });
    assert.deepStrictEqual(v2.marcadoresGlory, ['/Framework/']);
    assert.deepStrictEqual(v1.marcadoresGlory, ['/Framework/']);
  });

  test('una clave marcadoresGlory que no es lista de cadenas se rechaza', () => {
    assert.throws(() => validateSentinelConfig({ marcadoresGlory: 'Glory' }), /marcadoresGlory/);
  });
});
