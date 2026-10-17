/*
 * [17AA-2] Cobertura de `.mjs`/`.cjs` y `.mts`/`.cts`.
 *
 * Antes un `.mjs` se quedaba en `plaintext`: `languageIdForFile` no lo mapeaba y
 * las reglas filtran por `aplicaA`, que lista `.js`. El archivo se descartaba sin
 * analizar aunque `obtenerLimiteArchivo` ya le diera techo 300. Estos tests fijan
 * las dos mitades —el mapeo y el filtro— y llevan testigo: el mismo contenido
 * como `.js` tiene que dar el mismo resultado, y como `.txt` ninguno.
 */

import * as assert from 'assert';
import { extensionCanonica, languageIdForFile } from '../../core/language';
import { analizarEstatico } from '../../analyzers/staticAnalyzer';
import { createCoreDocument } from '../../core/types';

function documento(fileName: string, contenido: string) {
  return createCoreDocument({
    uri: `file:///${fileName}`,
    fileName,
    languageId: languageIdForFile(fileName),
    content: contenido,
  });
}

/* Contenido sin comentarios ni lineas vacias: `contarLineasEfectivas` cuenta lo que ve. */
function codigoDeLineas(n: number): string {
  const lineas: string[] = [];
  for (let i = 0; i < n; i++) lineas.push(`const v${i} = ${i};`);
  return lineas.join('\n');
}

function idsDe(fileName: string, contenido: string): string[] {
  return analizarEstatico(documento(fileName, contenido)).map(v => v.reglaId);
}

suite('cobertura de .mjs (17AA-2)', () => {

  test('extensionCanonica - los modulos cuentan como su equivalente', () => {
    assert.strictEqual(extensionCanonica('.mjs'), '.js');
    assert.strictEqual(extensionCanonica('.cjs'), '.js');
    assert.strictEqual(extensionCanonica('.mts'), '.ts');
    assert.strictEqual(extensionCanonica('.cts'), '.ts');
  });

  test('extensionCanonica - acepta ruta o extension y no inventa equivalencias', () => {
    assert.strictEqual(extensionCanonica('scripts/largo.mjs'), '.js');
    assert.strictEqual(extensionCanonica('.ts'), '.ts');
    assert.strictEqual(extensionCanonica('src/app.tsx'), '.tsx');
    assert.strictEqual(extensionCanonica('.rs'), '.rs');
  });

  test('languageIdForFile - .mjs y .cjs son javascript, .mts y .cts son typescript', () => {
    assert.strictEqual(languageIdForFile('scripts/alta.mjs'), 'javascript');
    assert.strictEqual(languageIdForFile('scripts/legacy.cjs'), 'javascript');
    assert.strictEqual(languageIdForFile('scripts/tipos.mts'), 'typescript');
    assert.strictEqual(languageIdForFile('scripts/tipos.cts'), 'typescript');
  });

  test('limite-lineas alcanza un .mjs largo', () => {
    const ids = idsDe('scripts/largo.mjs', codigoDeLineas(350));
    assert.ok(ids.includes('limite-lineas'), `esperaba limite-lineas, hubo: ${ids.join(', ') || 'ninguno'}`);
  });

  test('testigo - el mismo contenido como .js da lo mismo y como .txt nada', () => {
    const contenido = codigoDeLineas(350);
    const enJs = idsDe('scripts/largo.js', contenido);
    const enMjs = idsDe('scripts/largo.mjs', contenido);
    assert.ok(enJs.includes('limite-lineas'), 'el testigo .js tiene que marcar: si no, el test no prueba nada');
    assert.deepStrictEqual(enMjs, enJs);

    const enTexto = idsDe('scripts/largo.txt', contenido);
    assert.ok(!enTexto.includes('limite-lineas'), 'un .txt no es codigo y no debe tener techo de componente');
  });

  test('las reglas con aplicaA que listan .js tambien corren sobre .mjs', () => {
    const contenido = '// todo esto hay que rehacerlo cuando cambie el modelo\nconst a = 1;\n';
    const enMjs = idsDe('scripts/nota.mjs', contenido);
    const enJs = idsDe('scripts/nota.js', contenido);
    assert.ok(enJs.includes('todo-prosa-sin-marcador'), 'el testigo .js tiene que marcar: si no, el test no prueba nada');
    assert.deepStrictEqual(enMjs, enJs);
  });
});
