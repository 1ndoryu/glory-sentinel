import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { estaGloryActivo, inicializarGloryAnalyzer, inicializarGloryParaWorkspaces } from '../../../analyzers/gloryAnalyzer';
import { analizarApiEndpoints } from '../../../analyzers/externos/apiEndpointAnalyzer';
import { CoreWorkspaceContext, createCoreDocument } from '../../../core/runtime-proyecto/types';
import { tempDir } from '../../temporales';

/* [SQ-3] Glory solo se activa con perfil Glory (carpeta `Glory`) o `rutasGlory` declarado.
 * Sin eso no indexa nada y sus reglas (p. ej. api-endpoint-faltante) no se aplican. */

function crearWorkspace(conCarpetaGlory: boolean): string {
  const root = tempDir('glory-activacion-');
  fs.writeFileSync(path.join(root, 'openapi.json'), JSON.stringify({ paths: {} }));
  if (conCarpetaGlory) {
    fs.mkdirSync(path.join(root, 'Glory'), { recursive: true });
  }
  return root;
}

function contextoWorkspace(root: string): CoreWorkspaceContext {
  return {
    rootPath: root,
    config: { enabled: true, includePatterns: [], excludePatterns: [], ruleOverrides: {} },
  };
}

/* Llamada legacy que no está en el openapi vacío (/pruebas no tiene mapeo): con Glory activo debe producir un hallazgo. */
function documentoLegacy(root: string) {
  const fileName = path.join(root, 'legacy', 'services', 'perfil.ts');
  return createCoreDocument({
    uri: fileName,
    fileName,
    languageId: 'typescript',
    content: "apiGet('/pruebas');\n",
  });
}

suite('Glory: activación por perfil [SQ-3]', () => {
  teardown(() => inicializarGloryAnalyzer([], undefined, false));

  test('sin carpeta Glory ni rutasGlory no se activa y no aplica api-endpoint-faltante', async () => {
    const root = crearWorkspace(false);
    try {
      await inicializarGloryParaWorkspaces([root]);
      assert.strictEqual(estaGloryActivo(), false);
      assert.strictEqual(analizarApiEndpoints(documentoLegacy(root), contextoWorkspace(root)).length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('con carpeta Glory se activa y el mismo documento produce el hallazgo (testigo)', async () => {
    const root = crearWorkspace(true);
    try {
      await inicializarGloryParaWorkspaces([root]);
      assert.strictEqual(estaGloryActivo(), true);
      const hallazgos = analizarApiEndpoints(documentoLegacy(root), contextoWorkspace(root));
      assert.strictEqual(hallazgos.length, 1);
      assert.ok(hallazgos[0].mensaje.includes('GET /api/pruebas'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rutasGlory declarado activa aunque no haya carpeta Glory', async () => {
    const root = crearWorkspace(false);
    try {
      await inicializarGloryParaWorkspaces([root], {});
      assert.strictEqual(estaGloryActivo(), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
