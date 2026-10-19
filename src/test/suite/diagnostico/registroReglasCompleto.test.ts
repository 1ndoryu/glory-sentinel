import * as assert from 'assert';
import { obtenerIdsReglas } from '../../../config/ruleRegistry';

/* Cuatro reglas emitidas por el analisis no estaban en el registro: no se podian
 * configurar ni aparecian en rules.md. Este test impide que vuelva a pasar. */
suite('registro de reglas — cobertura de emisores', () => {
  const ids = new Set(obtenerIdsReglas());

  for (const id of [
    'css-adhoc-button-style',
    'sqlx-query-sin-macro',
    'sqlx-query-as-sin-macro',
    'api-endpoint-faltante',
  ]) {
    test(`${id} esta registrada`, () => {
      assert.ok(ids.has(id), `${id} debe estar en REGISTRO de ruleRegistry.ts`);
    });
  }
});
