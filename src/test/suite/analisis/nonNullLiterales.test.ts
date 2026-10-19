/* [por que] La regla de non-null (`!`) de producción se probaba solo con una copia local en
 * sprint5Rules.test.ts, y la copia contaba `!` dentro de cadenas: los archivos de test con
 * código de ejemplo salían con falsos positivos. Estas pruebas llaman a la función real.
 * Va en analisis/ porque reglas/ ya tiene 10 archivos (budget de directorio-abarrotado). */
import * as assert from 'assert';
import { createCoreDocument } from '../../../core/runtime-proyecto/types';
import { verificarNonNullAssertion } from '../../../analyzers/static/staticCodeRules';

function verificar(content: string) {
  const doc = createCoreDocument({ uri: 'file:///repo/x.ts', fileName: '/repo/x.ts', languageId: 'typescript', content });
  return verificarNonNullAssertion(content, doc);
}

suite('non-null-assertion-excesivo: literales de cadena', () => {

  test('un ! dentro de cadenas simples, dobles o de plantilla no cuenta', () => {
    const content = [
      "const a = 'obj!.campo';",
      'const b = "arr!.valor";',
      'const c = `ref!.current`;',
      "const d = 'getData()!.field';",
      'const e = "map!.name";',
      'const f = `x!.y`;',
    ].join('\n');
    assert.strictEqual(verificar(content).length, 0);
  });

  test('las cadenas no inflan el umbral: 4 reales + 3 en cadenas no llegan a 5', () => {
    const content = [
      'const a = obj!.campo;',
      'const b = ref.current!.value;',
      'const c = arr[0]!.prop;',
      'const d = getData()!.name;',
      "const e = 'mock!.x';",
      "const f = 'mock!.y';",
      "const g = 'mock!.z';",
    ].join('\n');
    assert.strictEqual(verificar(content).length, 0);
  });

  test('una aserción real junto a una cadena en la misma línea sí cuenta', () => {
    const content = [
      "const s = 'a!.b'; const a = obj!.campo;",
      'const b = ref.current!.value;',
      'const c = arr[0]!.prop;',
      'const d = getData()!.name;',
      'const e = map.get(k)!.val;',
    ].join('\n');
    const v = verificar(content);
    assert.strictEqual(v.length, 5);
    assert.strictEqual(v[0].linea, 0);
  });

  test('una comilla escapada no cierra la cadena antes de tiempo', () => {
    const content = [
      "const s = 'it\\'s obj!.x';",
      "const a = obj!.campo;",
      'const b = ref.current!.value;',
      'const c = arr[0]!.prop;',
      'const d = getData()!.name;',
      'const e = map.get(k)!.val;',
    ].join('\n');
    assert.strictEqual(verificar(content).length, 5);
  });
});
