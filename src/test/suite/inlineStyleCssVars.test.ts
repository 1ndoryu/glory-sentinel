import * as assert from 'assert';
import { reglasEstaticas } from '../../config/defaultRules';
import { analizarEstatico } from '../../analyzers/staticAnalyzer';

function crearDocumento(texto: string, fileName = 'src/components/panel/HostingStats.tsx') {
  const lineas = texto.split('\n');

  return {
    fileName,
    lineCount: lineas.length,
    languageId: 'typescriptreact',
    getText: () => texto,
    lineAt: (line: number) => ({ text: lineas[line] ?? '' }),
  } as never;
}

suite('inline-style-prohibido con CSS vars', () => {
  test('ignora style inline de una sola linea cuando solo define custom properties', () => {
    const regla = reglasEstaticas.find(r => r.id === 'inline-style-prohibido');
    assert.ok(regla, 'La regla inline-style-prohibido debe existir');

    const texto = '<div className="barra" style={{\'--hosting-bar-width\': `${percent}%`} as CSSProperties} />';
    const violaciones = analizarEstatico(crearDocumento(texto), [regla!]);
    assert.strictEqual(violaciones.length, 0);
  });
});