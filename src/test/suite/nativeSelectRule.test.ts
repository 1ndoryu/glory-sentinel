import * as assert from 'assert';
import { verificarHtmlNativoEnVezDeComponente } from '../../analyzers/react/reactComponentRules';

suite('select-nativo-prohibido', () => {
  test('detecta select nativo aunque no exista componente Select con nombre literal', () => {
    const violaciones = verificarHtmlNativoEnVezDeComponente([
      '<label>VPS<select value={target} onChange={cambiarTarget}>',
      '  <option value="default">default</option>',
      '</select></label>',
    ], 'Formulario.tsx');

    assert.strictEqual(violaciones.length, 1);
    assert.strictEqual(violaciones[0].reglaId, 'html-nativo-en-vez-de-componente');
    assert.match(violaciones[0]?.mensaje || '', /selector personalizado/);
  });

  test('no confunde componentes Selector personalizados con select nativo', () => {
    const violaciones = verificarHtmlNativoEnVezDeComponente([
      '<SelectorPersonalizado etiqueta="VPS" valor={target} opciones={opciones} onCambiar={setTarget} />',
    ], 'Formulario.tsx');

    assert.strictEqual(violaciones.length, 0);
  });
});