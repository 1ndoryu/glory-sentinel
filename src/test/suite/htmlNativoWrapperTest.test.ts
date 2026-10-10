/* [08AA-26] html-nativo-en-vez-de-componente no vigila los wrappers de components/ui
 * (sistema de diseno). Ver esWrapperSistemaDiseno. */
import * as assert from 'assert';
import { esWrapperSistemaDiseno } from '../../analyzers/react/reactComponentRules';

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
