import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCoreConfig, validateSentinelConfig } from '../../../core/runtime-proyecto/config';
import { configurarRutasControllers, obtenerRutasControllers } from '../../../analyzers/glory/api/apiContractIndexer';
import { configurarBasesUiReact, existeComponenteUi } from '../../../analyzers/react/reglas/reactUiCatalog';
import { configurarWorkspaceRootsReact } from '../../../analyzers/react/reglas/reactComponentRules';

/* [T2c] `rutasGlory` del sentinel.config.json sustituye las carpetas Glory por defecto
 * (controllers PHP y design system React). Sin la clave, los defaults no cambian. */
suite('rutasGlory configurable [T2c]', () => {
  const CONTROLLERS_POR_DEFECTO = [['App', 'Api'], ['App', 'Kamples', 'Api', 'Controladores']];

  teardown(() => {
    configurarRutasControllers(undefined);
    configurarBasesUiReact(undefined);
    configurarWorkspaceRootsReact([]);
  });

  test('acepta el contrato y lo pasa a la config del core', () => {
    const input = { rutasGlory: { controladores: [['Mi', 'Api']], carpetasUi: [['src', 'ui']] } };
    validateSentinelConfig(input);
    assert.deepStrictEqual(buildCoreConfig(input).rutasGlory, input.rutasGlory);
  });

  test('rechaza claves desconocidas y listas mal formadas', () => {
    assert.throws(() => validateSentinelConfig({ rutasGlory: { otra: [] } }), /clave desconocida 'rutasGlory.otra'/);
    assert.throws(() => validateSentinelConfig({ rutasGlory: { controladores: 'App/Api' } }), /rutasGlory.controladores/);
    assert.throws(() => validateSentinelConfig({ rutasGlory: { carpetasUi: ['src/ui'] } }), /rutasGlory.carpetasUi/);
    assert.throws(() => validateSentinelConfig({ rutasGlory: { carpetasUi: [[]] } }), /rutasGlory.carpetasUi/);
    assert.throws(() => validateSentinelConfig({ rutasGlory: { controladores: [['App', 1]] } }), /rutasGlory.controladores/);
    assert.throws(() => validateSentinelConfig({ rutasGlory: [] }), /'rutasGlory' debe ser un objeto/);
  });

  test('los controllers usan la lista configurada y vuelven a los defaults al quitarla', () => {
    assert.deepStrictEqual(obtenerRutasControllers(), CONTROLLERS_POR_DEFECTO);
    configurarRutasControllers([['Mi', 'Api']]);
    assert.deepStrictEqual(obtenerRutasControllers(), [['Mi', 'Api']]);
    configurarRutasControllers(undefined);
    assert.deepStrictEqual(obtenerRutasControllers(), CONTROLLERS_POR_DEFECTO);
    configurarRutasControllers([]);
    assert.deepStrictEqual(obtenerRutasControllers(), CONTROLLERS_POR_DEFECTO);
  });

  test('el catalogo UI busca solo en las carpetas configuradas', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rutas-glory-'));
    try {
      fs.mkdirSync(path.join(root, 'mi-ui'), { recursive: true });
      fs.writeFileSync(path.join(root, 'mi-ui', 'Boton.tsx'), '');
      configurarWorkspaceRootsReact([root]);

      /* Con los defaults, mi-ui no es una carpeta de design system. */
      configurarBasesUiReact(undefined);
      assert.strictEqual(existeComponenteUi(['Boton']), false);

      /* Al configurarla, el componente aparece. El cambio de bases vacia la cache de existencia. */
      configurarBasesUiReact([['mi-ui']]);
      assert.strictEqual(existeComponenteUi(['Boton']), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
