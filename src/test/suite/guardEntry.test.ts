/* [10AA-2] Parseo de la entrada in-process del guard (`current.js guard …`).
 * Debe aceptar exactamente lo que acepta `sentinel guard` (args.ts): opciones
 * antes de `--` y argumentos de la herramienta después. */
import * as assert from 'assert';
import { parseGuardArgv } from '../../core/guardEntry';

suite('Sentinel core guardEntry (entrada in-process del guard)', () => {
  test('separa opciones de los argumentos de la herramienta tras --', () => {
    const parsed = parseGuardArgv([
      'guard', '--project-root', 'C:\\proj', '--executable', 'cargo', '--json', '--', 'build', '--release',
    ]);
    assert.strictEqual(parsed.executable, 'cargo');
    assert.strictEqual(parsed.projectRoot, 'C:\\proj');
    assert.strictEqual(parsed.workspace, undefined);
    assert.strictEqual(parsed.json, true);
    assert.deepStrictEqual(parsed.guardArgs, ['build', '--release']);
  });

  test('sin -- los argumentos de la herramienta quedan vacíos', () => {
    const parsed = parseGuardArgv(['guard', '--executable', 'npm']);
    assert.strictEqual(parsed.executable, 'npm');
    assert.deepStrictEqual(parsed.guardArgs, []);
    assert.strictEqual(parsed.json, false);
  });

  test('un argumento de herramienta que parece opción no se interpreta como opción del guard', () => {
    const parsed = parseGuardArgv(['guard', '--executable', 'cargo', '--', '--json', 'test']);
    assert.strictEqual(parsed.json, false);
    assert.deepStrictEqual(parsed.guardArgs, ['--json', 'test']);
  });

  test('rechaza una opción desconocida antes de --', () => {
    assert.throws(() => parseGuardArgv(['guard', '--ejecutable', 'npm']), /opción desconocida/);
  });

  test('rechaza una opción con valor ausente', () => {
    assert.throws(() => parseGuardArgv(['guard', '--executable']), /falta valor para --executable/);
    assert.throws(() => parseGuardArgv(['guard', '--executable', '--json']), /falta valor para --executable/);
  });
});
