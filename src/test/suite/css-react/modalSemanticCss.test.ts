import * as assert from 'assert';
import { CoreTextDocument } from '../../../core/runtime-proyecto/types';
import { verificarModalSemanticaNoCanonica } from '../../../analyzers/static/staticCssRules';

function crearDocumento(fileName: string) {
  return { fileName } as CoreTextDocument;
}

const RUTA_MODAL = '/repo/frontend/src/components/servicios/ModalCompra.css';

suite('modal-semantica-no-canonica', () => {
  /* [15A-25] `modalTexto` estaba en la lista de clases canonicas pero NO existe en
   * ninguna hoja del sistema: los hallazgos que la prescribian eran inaplicables.
   * Solo se detectan los sufijos cuyo destino existe (.modalTitulo, .modalAcciones). */
  test('no prescribe modalTexto, que no es una clase del sistema', () => {
    const texto = '.ordenDetalleModalTexto { color: var(--text-muted); line-height: 1.5; }';
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento('/repo/frontend/src/components/panel/OrdenDetalle.css'), 'OrdenDetalle.css');

    assert.strictEqual(violaciones.length, 0);
  });

  test('no prescribe modalTexto para clases de descripcion', () => {
    const texto = '.modalCompraDescripcion { font-size: var(--text-sm); color: var(--text-dark); }';
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento(RUTA_MODAL), 'ModalCompra.css');

    assert.strictEqual(violaciones.length, 0);
  });

  test('detecta un titulo local que duplica la receta de modalTitulo', () => {
    const texto = '.ordenDetalleModalTitulo { font-size: 13px; line-height: 1.2; }';
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento(RUTA_MODAL), 'ModalCompra.css');

    assert.strictEqual(violaciones.length, 1);
    assert.strictEqual(violaciones[0]?.reglaId, 'modal-semantica-no-canonica');
    assert.match(violaciones[0]?.mensaje || '', /modalTitulo/);
  });

  /* [15A-25] .modalAcciones es `display:flex; gap` y da flex:1 a sus hijos: un pie que
   * reparte a los extremos o se separa con un borde propio no es esa receta, y seguir la
   * recomendacion encogeria los botones. Tres de los cuatro casos de KAMPLES eran esto. */
  test('detecta la zona de acciones que duplica literalmente la receta', () => {
    const texto = '.ordenDetalleModalAcciones { display: flex; gap: var(--espacioSm); }';
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento(RUTA_MODAL), 'ModalCompra.css');

    assert.strictEqual(violaciones.length, 1);
    assert.match(violaciones[0]?.mensaje || '', /modalAcciones/);
  });

  test('no dispara cuando el pie declara layout que la receta no expresa', () => {
    const textos = [
      '.configModalAcciones { display: flex; justify-content: flex-end; gap: var(--espacioSm); padding: var(--espacioMd); border-top: 1px solid var(--bordeSutil); }',
      '.generosModalAcciones { display: flex; align-items: center; width: 100%; max-width: 520px; padding-top: var(--espacioMd); }',
      '.modalCodigoExpiradoAcciones { display: flex; gap: var(--espacioSm); justify-content: flex-end; flex-wrap: wrap; }',
    ];

    for (const texto of textos) {
      const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento(RUTA_MODAL), 'ModalCompra.css');
      assert.strictEqual(violaciones.length, 0, texto);
    }
  });

  test('ignora clases canonicas del sistema', () => {
    const texto = [
      '.modalTitulo { font-size: 13px; line-height: 1.2; }',
      '.modalAcciones { display: flex; gap: var(--spacing-sm); }',
    ].join('\n');
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento('/repo/frontend/src/components/ui/Modal.css'), 'Modal.css');

    assert.strictEqual(violaciones.length, 0);
  });

  test('ignora layout de resumen que no define semantica textual', () => {
    const texto = '.modalCompraResumen { display: flex; gap: var(--spacing-sm); }';
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento(RUTA_MODAL), 'ModalCompra.css');

    assert.strictEqual(violaciones.length, 0);
  });

  test('respeta sentinel-disable-next-line', () => {
    const texto = [
      '/* sentinel-disable-next-line modal-semantica-no-canonica */',
      '.usuariosModalTitulo { font-size: 13px; }',
    ].join('\n');
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento('/repo/frontend/src/components/panel/UsuariosAcciones.css'), 'UsuariosAcciones.css');

    assert.strictEqual(violaciones.length, 0);
  });
});
