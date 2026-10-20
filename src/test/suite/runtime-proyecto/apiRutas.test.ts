import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { buildCoreConfig, validateSentinelConfig } from '../../../core/runtime-proyecto/config';
import { analizarApiEndpoints } from '../../../analyzers/externos/apiEndpointAnalyzer';
import { inicializarGloryAnalyzer } from '../../../analyzers/gloryAnalyzer';
import { createCoreDocument } from '../../../core/runtime-proyecto/types';
import { tempDir } from '../../temporales';

/* [T2b] `apiRutas` del sentinel.config.json sustituye los defaults de mapeo legacy -> openapi.
 * Se prueba la validacion del contrato y que el analyzer usa la tabla configurada. */
suite('apiRutas configurable [T2b]', () => {
  test('acepta el contrato y lo pasa a la config del core', () => {
    const input = { apiRutas: { mapa: { '/a': '/b' }, mantener: ['/c'], prefijosMantener: ['/d'], prefijosMapa: { '/e': '/f' } } };
    validateSentinelConfig(input);
    assert.deepStrictEqual(buildCoreConfig(input).apiRutas, input.apiRutas);
  });

  test('rechaza claves desconocidas y tipos incorrectos', () => {
    assert.throws(() => validateSentinelConfig({ apiRutas: { otra: {} } }), /clave desconocida 'apiRutas.otra'/);
    assert.throws(() => validateSentinelConfig({ apiRutas: { mapa: { '/a': 1 } } }), /apiRutas.mapa/);
    assert.throws(() => validateSentinelConfig({ apiRutas: { mantener: '/a' } }), /apiRutas.mantener/);
    assert.throws(() => validateSentinelConfig({ apiRutas: [] }), /'apiRutas' debe ser un objeto/);
  });

  test('el analyzer usa la tabla configurada en vez de los defaults', () => {
    const root = tempDir('api-rutas-');
    /* [SQ-3] El analyzer solo corre con Glory activo: se activa explícitamente para este caso. */
    inicializarGloryAnalyzer([root], {}, true);
    try {
      fs.writeFileSync(path.join(root, 'openapi.json'), JSON.stringify({ paths: { '/api/users/me': { get: {} } } }));
      const fileName = path.join(root, 'legacy', 'services', 'perfil.ts');
      const documento = createCoreDocument({
        uri: fileName,
        fileName,
        languageId: 'typescript',
        content: "apiGet('/me');\n",
      });
      const workspace = (rutas?: object) => ({
        rootPath: root,
        config: { enabled: true, includePatterns: [], excludePatterns: [], ruleOverrides: {}, apiRutas: rutas },
      });

      /* Sin apiRutas: /me -> /users/me existe en openapi, no hay hallazgo. */
      assert.strictEqual(analizarApiEndpoints(documento, workspace(undefined)).length, 0);
      /* Con tabla vacia: /me se queda tal cual y no existe en openapi. */
      const sinMapeo = analizarApiEndpoints(documento, workspace({}));
      assert.strictEqual(sinMapeo.length, 1);
      assert.ok(sinMapeo[0].mensaje.includes('GET /api/me'));
    } finally {
      inicializarGloryAnalyzer([], undefined, false);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
