/*
 * Tests para las reglas estaticas (regex patterns).
 * Verifica que cada patron detecta violaciones correctamente
 * y no produce falsos positivos en codigo valido.
 */

import * as assert from 'assert';
import { reglasEstaticas } from '../../config/defaultRules';

suite('Reglas Estaticas - Regex Patterns', () => {

  /* Helper para testear una regla contra una linea de codigo */
  function testearRegla(reglaId: string, texto: string): boolean {
    const regla = reglasEstaticas.find(r => r.id === reglaId);
    if (!regla) {
      throw new Error(`Regla "${reglaId}" no encontrada`);
    }
    const patron = new RegExp(regla.patron.source, regla.patron.flags.replace('g', ''));
    return patron.test(texto);
  }

  /* php-supresor-at */
  suite('php-supresor-at', () => {
    test('detecta @unlink()', () => {
      assert.strictEqual(testearRegla('php-supresor-at', '@unlink($archivo)'), true);
    });

    test('detecta @file_get_contents()', () => {
      assert.strictEqual(testearRegla('php-supresor-at', '$data = @file_get_contents($url);'), true);
    });

    test('no detecta unlink() sin @', () => {
      assert.strictEqual(testearRegla('php-supresor-at', 'unlink($archivo)'), false);
    });

    test('detecta @mkdir()', () => {
      assert.strictEqual(testearRegla('php-supresor-at', '@mkdir($dir, 0755, true)'), true);
    });
  });

  /* eval-prohibido */
  suite('eval-prohibido', () => {
    test('detecta eval()', () => {
      assert.strictEqual(testearRegla('eval-prohibido', 'eval($codigo)'), true);
    });

    test('no detecta evaluate()', () => {
      assert.strictEqual(testearRegla('eval-prohibido', 'evaluate($expr)'), false);
    });

    test('detecta eval con espacio', () => {
      assert.strictEqual(testearRegla('eval-prohibido', 'eval ($code)'), true);
    });
  });

  /* css-inline-jsx */
  suite('css-inline-jsx', () => {
    test('detecta style={{}}', () => {
      assert.strictEqual(testearRegla('css-inline-jsx', 'style={{ color: "red" }}'), true);
    });

    test('no detecta style={variable}', () => {
      assert.strictEqual(testearRegla('css-inline-jsx', 'style={claseEstilo}'), false);
    });
  });

  /* catch-vacio */
  suite('catch-vacio', () => {
    test('detecta catch vacio simple', () => {
      assert.strictEqual(testearRegla('catch-vacio', 'catch (e) {}'), true);
    });

    test('detecta catch vacio con espacios', () => {
      assert.strictEqual(testearRegla('catch-vacio', 'catch (error) {  }'), true);
    });

    test('no detecta catch con contenido', () => {
      assert.strictEqual(testearRegla('catch-vacio', 'catch (e) { console.error(e); }'), false);
    });
  });

  /* hardcoded-secret */
  suite('hardcoded-secret', () => {
    test('detecta password hardcodeado', () => {
      assert.strictEqual(testearRegla('hardcoded-secret', 'password = "admin1234"'), true);
    });

    test('detecta api_key hardcodeado', () => {
      assert.strictEqual(testearRegla('hardcoded-secret', "api_key = 'sk_live_abc123'"), true);
    });

    test('no detecta password vacio', () => {
      assert.strictEqual(testearRegla('hardcoded-secret', "password = ''"), false);
    });

    test('no detecta password con 3 chars (< 4)', () => {
      assert.strictEqual(testearRegla('hardcoded-secret', "password = 'abc'"), false);
    });
  });

  /* git-add-all */
  suite('git-add-all', () => {
    test('detecta git add .', () => {
      assert.strictEqual(testearRegla('git-add-all', 'git add .'), true);
    });

    test('detecta git add --all', () => {
      assert.strictEqual(testearRegla('git-add-all', 'git add --all'), true);
    });

    test('no detecta git add archivo.ts', () => {
      assert.strictEqual(testearRegla('git-add-all', 'git add archivo.ts'), false);
    });
  });

  /* barras-decorativas */
  suite('barras-decorativas', () => {
    test('detecta ====', () => {
      assert.strictEqual(testearRegla('barras-decorativas', '// ================'), true);
    });

    test('no detecta 3 iguales', () => {
      assert.strictEqual(testearRegla('barras-decorativas', '// ==='), false);
    });
  });

  /* innerhtml-variable */
  suite('innerhtml-variable', () => {
    test('detecta innerHTML con variable', () => {
      assert.strictEqual(testearRegla('innerhtml-variable', 'el.innerHTML = contenido'), true);
    });

    test('no detecta innerHTML con string literal', () => {
      assert.strictEqual(testearRegla('innerhtml-variable', 'el.innerHTML = "texto fijo"'), false);
    });
  });

  /* wpdb-sin-prepare: movido a phpAnalyzer.ts con logica contextual.
   * La deteccion por regex simple no puede excluir START TRANSACTION /
   * ROLLBACK / COMMIT. Los tests de este caso viven en phpAnalyzer.test.ts */
});
