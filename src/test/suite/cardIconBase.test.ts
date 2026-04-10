import * as assert from 'assert';
import { verificarCardIconoExtiendeBase } from '../../analyzers/static/staticCssRules';

function analizarCss(texto: string, fileName = 'SeccionHosting.css') {
  return verificarCardIconoExtiendeBase(
    texto,
    { fileName } as never,
    fileName,
  );
}

suite('card-icono-debe-extender-base', () => {
  test('detecta variante CardIcono que recrea la base', () => {
    const css = [
      '.hostingCardIcono {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  width: 140px;',
      '}',
    ].join('\n');

    const violaciones = analizarCss(css);
    assert.strictEqual(violaciones.length, 1);
    assert.strictEqual(violaciones[0]?.reglaId, 'card-icono-debe-extender-base');
  });

  test('ignora panelCardIcono porque es la base compartida', () => {
    const css = [
      '.panelCardIcono {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '}',
    ].join('\n');

    const violaciones = analizarCss(css, 'PanelIsland.css');
    assert.strictEqual(violaciones.length, 0);
  });

  test('ignora variantes con solo overrides', () => {
    const css = [
      '.hostingCardIcono {',
      '  --panel-card-icono-width: 180px;',
      '  --panel-card-icono-bg: var(--bg-dark);',
      '}',
    ].join('\n');

    const violaciones = analizarCss(css);
    assert.strictEqual(violaciones.length, 0);
  });

  test('respeta sentinel-disable-next-line', () => {
    const css = [
      '/* sentinel-disable-next-line card-icono-debe-extender-base */',
      '.hostingCardIcono {',
      '  display: flex;',
      '  justify-content: center;',
      '}',
    ].join('\n');

    const violaciones = analizarCss(css);
    assert.strictEqual(violaciones.length, 0);
  });
});