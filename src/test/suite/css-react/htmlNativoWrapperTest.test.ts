/* [08AA-26] html-nativo-en-vez-de-componente no vigila los wrappers de components/ui
 * (sistema de diseno). Ver esWrapperSistemaDiseno. */
import * as assert from 'assert';
import { esDisparadorDisclosure, esWrapperSistemaDiseno } from '../../../analyzers/react/reglas/reactComponentRules';

suite('08AA-26 html-nativo: wrappers del sistema de diseno', () => {
  test('ruta de components/ui queda fuera, en POSIX y Windows', () => {
    assert.strictEqual(esWrapperSistemaDiseno('/repo/frontend/src/components/ui/textarea.tsx'), true);
    assert.strictEqual(esWrapperSistemaDiseno('C:\\repo\\frontend\\src\\components\\ui\\textarea.tsx'), true);
  });

  test('componentes de la app siguen dentro del alcance', () => {
    assert.strictEqual(esWrapperSistemaDiseno('/repo/frontend/src/components/Galeria.tsx'), false);
    assert.strictEqual(esWrapperSistemaDiseno('/repo/src/components/uix/Card.tsx'), false);
    assert.strictEqual(esWrapperSistemaDiseno('/repo/frontend/src/app/layout.tsx'), false);
  });
});

suite('11AA-1 html-nativo: disparador de disclosure (aria-expanded)', () => {
  test('<button> con aria-expanded en lineas siguientes es disclosure', () => {
    const lineas = ['<button', '  type="button"', '  className="consolaFila"', '  aria-expanded={abierto}', '>'];
    assert.strictEqual(esDisparadorDisclosure(lineas, 0), true);
  });

  test('<button> sin aria-expanded sigue dentro del alcance', () => {
    const lineas = ['<button type="button" onClick={guardar}>', 'Guardar', '</button>'];
    assert.strictEqual(esDisparadorDisclosure(lineas, 0), false);
  });

  test('aria-expanded fuera de la ventana de 6 lineas no cuenta', () => {
    const lineas = ['<button>', 'a', 'b', 'c', 'd', 'e', '<span aria-expanded={x} />'];
    assert.strictEqual(esDisparadorDisclosure(lineas, 0), false);
  });
});
