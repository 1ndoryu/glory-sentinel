/* sentinel-disable-file eval-prohibido innerhtml-variable catch-vacio hardcoded-secret: archivo de muestras de detectores; las líneas son entradas de prueba. */
/*
 * Tests para las reglas estaticas (regex patterns).
 * Verifica que cada patron detecta violaciones correctamente
 * y no produce falsos positivos en codigo valido.
 */

import * as assert from 'assert';
import { reglasEstaticas } from '../../config/defaultRules';
import { analizarEstatico } from '../../analyzers/staticAnalyzer';

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

  /* Filtros del analizador (ruta de test, constantes canario): van por
   * analizarEstatico, no por el regex suelto de testearRegla. */
  suite('filtros de analizarEstatico', () => {
    function violacionesDe(reglaId: string, texto: string, fileName: string): number {
      const regla = reglasEstaticas.find(r => r.id === reglaId);
      assert.ok(regla, `Regla "${reglaId}" no encontrada`);
      const lineas = texto.split('\n');
      const documento = {
        fileName,
        lineCount: lineas.length,
        languageId: 'typescript',
        getText: () => texto,
        lineAt: (line: number) => ({ text: lineas[line] ?? '' }),
      } as never;
      return analizarEstatico(documento, [regla!]).length;
    }

    test('emoji-en-codigo: no aplica en archivo .test.ts', () => {
      assert.strictEqual(violacionesDe('emoji-en-codigo', 'assert.match(s, /🌍/);', 'src/x.test.ts'), 0);
    });

    test('emoji-en-codigo: no aplica en carpeta test con ruta Windows', () => {
      assert.strictEqual(violacionesDe('emoji-en-codigo', 'assert.match(s, /🌍/);', 'C:\\proj\\src\\test\\suite\\x.ts'), 0);
    });

    test('emoji-en-codigo: sigue detectando en codigo de produccion (testigo)', () => {
      assert.strictEqual(violacionesDe('emoji-en-codigo', 'assert.match(s, /🌍/);', 'src/x.ts'), 1);
      assert.strictEqual(violacionesDe('emoji-en-codigo', 'export const etiqueta = <span>🌍</span>;', 'src/x.tsx'), 1);
    });

    test('hardcoded-secret: ignora constante canario en MAYUSCULAS', () => {
      assert.strictEqual(violacionesDe('hardcoded-secret', "const secret = 'SECRET_QUERY'", 'src/x.ts'), 0);
    });

    test('hardcoded-secret: sigue detectando password con minusculas y digitos', () => {
      assert.strictEqual(violacionesDe('hardcoded-secret', 'password = "admin1234"', 'src/x.ts'), 1);
    });
  });
});
