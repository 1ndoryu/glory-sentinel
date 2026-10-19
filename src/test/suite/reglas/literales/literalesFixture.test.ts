/* [por que] Regresion: las reglas miraban el texto de las cadenas. Un fixture de test
 * con un marcador de tarea, `import {...}`, `: any` o HTML dentro de '...' generaba falsos positivos
 * en varsense. Estas pruebas fijan que solo cuenta el código y los comentarios reales. */
import * as assert from 'assert';
import { reglasEstaticas } from '../../../../config/defaultRules';
import { createCoreDocument } from '../../../../core/runtime-proyecto/types';
import { ejecutarReglaPorLinea } from '../../../../analyzers/static/analisis/staticReglasPorLinea';
import { verificarAnyType, verificarImportsMuertos } from '../../../../analyzers/static/reglasCodigo/importsYTipos';
import { verificarHtmlSinOrigenDeclarado } from '../../../../analyzers/static/reglasCodigo/htmlSinOrigen';
import { enmascararLiterales, enmascararLiteralesSimples } from '../../../../utils/analisis/literalesCodigo';

function doc(fileName: string, content: string) {
  return createCoreDocument({ uri: `file://${fileName}`, fileName, languageId: 'typescript', content });
}

function todos(lineas: string[]): number {
  const regla = reglasEstaticas.find(r => r.id === 'todo-pendiente');
  assert.ok(regla, 'existe regla todo-pendiente');
  return ejecutarReglaPorLinea(lineas, regla, doc('a.ts', lineas.join('\n')), new Set()).length;
}

suite('literales: solo código y comentarios reales', () => {
  test('enmascararLiterales oculta la cadena y deja visible el comentario', () => {
    const codigo = enmascararLiterales("x = 'a'; // it's TODO: real");
    assert.ok(codigo.includes('TODO'), 'el comentario tras un apóstrofo sigue visible');
    assert.ok(!enmascararLiterales("s = 'a: any'").includes(': any'));
  });

  test('enmascararLiteralesSimples deja visibles las plantillas con HTML', () => {
    assert.ok(enmascararLiteralesSimples('f = `<div>${x}</div>`').includes('<div>'));
    assert.ok(!enmascararLiteralesSimples("s = '`<div>`'").includes('<div>'));
  });

  test('todo-pendiente ignora el marcador dentro de una cadena', () => {
    assert.strictEqual(todos(["const s = '// TODO: fixture';"]), 0);
  });

  test('todo-pendiente marca el marcador real tras una cadena con apóstrofo', () => {
    assert.strictEqual(todos(['const s = "it\'s"; // TODO: real']), 1);
  });

  test('todo-pendiente marca el marcador real aunque el comentario tenga apóstrofos', () => {
    assert.strictEqual(todos(["// TODO: it's real"]), 1);
  });

  test('import-muerto ignora un import escrito dentro de una cadena', () => {
    const texto = 'const s = "import { CLASE_TEXTO } from \'x\'";\n';
    assert.strictEqual(verificarImportsMuertos(texto, doc('a.test.ts', texto)).length, 0);
  });

  test('import-muerto sigue marcando un import real sin uso', () => {
    const texto = "import { Foo } from 'x';\n";
    assert.strictEqual(verificarImportsMuertos(texto, doc('a.ts', texto)).length, 1);
  });

  test('any-type-explicito ignora ": any" dentro de una cadena', () => {
    const texto = "const s = 'x: any';\n";
    assert.strictEqual(verificarAnyType(texto, doc('a.ts', texto)).length, 0);
  });

  test('any-type-explicito sigue marcando un tipo any real', () => {
    const texto = 'const a: any = 1;\n';
    assert.strictEqual(verificarAnyType(texto, doc('a.ts', texto)).length, 1);
  });

  test('html-sin-origen ignora HTML dentro de una cadena entre comillas simples', () => {
    const texto = "export const s = '`<div>x</div>`';\n";
    assert.strictEqual(verificarHtmlSinOrigenDeclarado(texto, doc('a.ts', texto)).length, 0);
  });
});
