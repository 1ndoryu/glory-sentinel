import * as assert from 'assert';
import { reglasEstaticas } from '../../config/defaultRules';
import { analizarEstatico, tieneSentinelDisableFile } from '../../analyzers/staticAnalyzer';

function crearDocumento(texto: string, fileName = 'src/repositories/chat.rs') {
  const lineas = texto.split('\n');

  return {
    fileName,
    lineCount: lineas.length,
    getText: () => texto,
    lineAt: (line: number) => ({ text: lineas[line] ?? '' }),
    positionAt: (offset: number) => {
      const previo = texto.slice(0, offset);
      const partes = previo.split('\n');
      return {
        line: partes.length - 1,
        character: partes[partes.length - 1]?.length ?? 0,
      };
    },
  } as never;
}

suite('sentinel-disable-file — reglas regex', () => {
  test('detecta la deshabilitacion file-level para una regla puntual', () => {
    const texto = '/* sentinel-disable-file sqlx-query-sin-macro sqlx-query-as-sin-macro */';
    assert.strictEqual(tieneSentinelDisableFile(texto, 'sqlx-query-sin-macro'), true);
    assert.strictEqual(tieneSentinelDisableFile(texto, 'sqlx-query-as-sin-macro'), true);
    assert.strictEqual(tieneSentinelDisableFile(texto, 'todo-pendiente'), false);
  });

  test('analizarEstatico no reporta sqlx::query si el archivo la deshabilita', () => {
    const regla = reglasEstaticas.find(r => r.id === 'sqlx-query-sin-macro');
    assert.ok(regla, 'La regla sqlx-query-sin-macro debe existir');

    const texto = [
      '/* sentinel-disable-file sqlx-query-sin-macro */',
      'sqlx::query("SELECT 1")',
    ].join('\n');

    const violaciones = analizarEstatico(crearDocumento(texto), [regla!]);
    assert.strictEqual(violaciones.filter(v => v.reglaId === 'sqlx-query-sin-macro').length, 0);
  });

  test('analizarEstatico sigue reportando si no hay disable file', () => {
    const regla = reglasEstaticas.find(r => r.id === 'sqlx-query-sin-macro');
    assert.ok(regla, 'La regla sqlx-query-sin-macro debe existir');

    const texto = 'sqlx::query("SELECT 1")';
    const violaciones = analizarEstatico(crearDocumento(texto), [regla!]);
    assert.strictEqual(violaciones.filter(v => v.reglaId === 'sqlx-query-sin-macro').length, 1);
  });

  test('limite-lineas deshabilitado no silencia niveles graves', () => {
    const cuerpo = Array.from({ length: 1600 }, (_, i) => `pub struct Modelo${i};`).join('\n');
    const texto = `/* sentinel-disable-file limite-lineas */\n${cuerpo}`;

    const violaciones = analizarEstatico(crearDocumento(texto, 'src/models/hosting.rs'));
    const ids = violaciones.map(v => v.reglaId);

    assert.strictEqual(ids.includes('limite-lineas'), false);
    assert.strictEqual(ids.includes('limite-lineas-nivel-2'), true);
    assert.strictEqual(ids.includes('limite-lineas-nivel-3'), true);
    assert.strictEqual(ids.includes('limite-lineas-nivel-4'), true);
  });

  test('cada nivel de limite-lineas tiene disable-file independiente', () => {
    const cuerpo = Array.from({ length: 1600 }, (_, i) => `pub struct Modelo${i};`).join('\n');
    const texto = [
      '/* sentinel-disable-file limite-lineas limite-lineas-nivel-2 limite-lineas-nivel-3 */',
      cuerpo,
    ].join('\n');

    const violaciones = analizarEstatico(crearDocumento(texto, 'src/models/hosting.rs'));
    const ids = violaciones.map(v => v.reglaId);

    assert.strictEqual(ids.includes('limite-lineas'), false);
    assert.strictEqual(ids.includes('limite-lineas-nivel-2'), false);
    assert.strictEqual(ids.includes('limite-lineas-nivel-3'), false);
    assert.strictEqual(ids.includes('limite-lineas-nivel-4'), true);
  });
});
