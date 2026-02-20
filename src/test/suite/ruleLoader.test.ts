/*
 * Tests unitarios para ruleLoader.ts.
 * Verifica las funciones utilitarias de carga y filtrado de reglas:
 * debeExcluirse() y lenguajeHabilitado().
 * Estas funciones son logica pura sin dependencias de VS Code en runtime
 * (el modulo vscode se mockea a traves de registerMocks.js).
 */

import * as assert from 'assert';
import { debeExcluirse, lenguajeHabilitado } from '../../services/ruleLoader';

suite('ruleLoader - debeExcluirse()', () => {

  test('excluye archivos en node_modules', () => {
    assert.strictEqual(
      debeExcluirse('/proyecto/node_modules/lodash/index.js', ['**/node_modules/**']),
      true
    );
  });

  test('excluye archivos en carpeta vendor', () => {
    assert.strictEqual(
      debeExcluirse('/proyecto/vendor/composer/autoload.php', ['**/vendor/**']),
      true
    );
  });

  test('excluye archivos en dist', () => {
    assert.strictEqual(
      debeExcluirse('/proyecto/dist/bundle.js', ['**/dist/**']),
      true
    );
  });

  test('excluye archivos en out', () => {
    assert.strictEqual(
      debeExcluirse('/proyecto/out/extension.js', ['**/out/**']),
      true
    );
  });

  test('excluye archivos en _generated', () => {
    assert.strictEqual(
      debeExcluirse('/proyecto/src/_generated/Schema.ts', ['**/_generated/**']),
      true
    );
  });

  test('no excluye archivo normal en src', () => {
    assert.strictEqual(
      debeExcluirse('/proyecto/src/utils/helpers.ts', ['**/node_modules/**', '**/vendor/**']),
      false
    );
  });

  test('no excluye archivo en raiz del proyecto', () => {
    assert.strictEqual(
      debeExcluirse('/proyecto/index.ts', ['**/node_modules/**']),
      false
    );
  });

  test('excluye con multiples patrones (segundo patron coincide)', () => {
    assert.strictEqual(
      debeExcluirse('/proyecto/dist/app.js', ['**/node_modules/**', '**/dist/**', '**/out/**']),
      true
    );
  });

  test('no excluye cuando lista de exclusiones esta vacia', () => {
    assert.strictEqual(
      debeExcluirse('/proyecto/src/MiComponente.tsx', []),
      false
    );
  });

  test('excluye rutas con backslash (Windows)', () => {
    assert.strictEqual(
      debeExcluirse('C:\\proyecto\\node_modules\\lodash\\index.js', ['**/node_modules/**']),
      true
    );
  });

  test('excluye rutas con node_modules anidados', () => {
    assert.strictEqual(
      debeExcluirse('/proyecto/packages/mi-lib/node_modules/dep/index.js', ['**/node_modules/**']),
      true
    );
  });
});

suite('ruleLoader - lenguajeHabilitado()', () => {

  test('typescript esta habilitado', () => {
    assert.strictEqual(
      lenguajeHabilitado('typescript', ['typescript', 'typescriptreact', 'php']),
      true
    );
  });

  test('php esta habilitado', () => {
    assert.strictEqual(
      lenguajeHabilitado('php', ['typescript', 'typescriptreact', 'php']),
      true
    );
  });

  test('python no esta habilitado', () => {
    assert.strictEqual(
      lenguajeHabilitado('python', ['typescript', 'typescriptreact', 'php']),
      false
    );
  });

  test('lista vacia no habilita ningun lenguaje', () => {
    assert.strictEqual(lenguajeHabilitado('typescript', []), false);
  });

  test('css habilitado cuando esta en lista', () => {
    assert.strictEqual(
      lenguajeHabilitado('css', ['css', 'typescript']),
      true
    );
  });

  test('typescriptreact es diferente a typescript', () => {
    assert.strictEqual(
      lenguajeHabilitado('typescriptreact', ['typescript']),
      false
    );
    assert.strictEqual(
      lenguajeHabilitado('typescriptreact', ['typescript', 'typescriptreact']),
      true
    );
  });

  test('verifica case sensitive (javascript != JavaScript)', () => {
    assert.strictEqual(
      lenguajeHabilitado('JavaScript', ['javascript']),
      false
    );
  });
});
