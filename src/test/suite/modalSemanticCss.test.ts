import * as assert from 'assert';
import { verificarModalSemanticaNoCanonica } from '../../analyzers/static/staticCssRules';

function crearDocumento(fileName: string) {
  return { fileName } as any;
}

suite('modal-semantica-no-canonica', () => {
  test('detecta texto modal especifico por componente', () => {
    const texto = '.ordenDetalleModalTexto { color: var(--text-muted); line-height: 1.5; }';
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento('/repo/frontend/src/components/panel/OrdenDetalle.css'), 'OrdenDetalle.css');

    assert.strictEqual(violaciones.length, 1);
    assert.strictEqual(violaciones[0]?.reglaId, 'modal-semantica-no-canonica');
  });

  test('detecta descripcion local que deberia usar modalTexto', () => {
    const texto = '.modalCompraDescripcion { font-size: var(--text-sm); color: var(--text-dark); }';
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento('/repo/frontend/src/components/servicios/ModalCompra.css'), 'ModalCompra.css');

    assert.strictEqual(violaciones.length, 1);
    assert.match(violaciones[0]?.mensaje || '', /modalTexto/);
  });

  test('ignora clases canonicas del sistema', () => {
    const texto = [
      '.modalTexto { color: var(--text-muted); line-height: 1.5; }',
      '.modalAcciones { display: flex; gap: var(--spacing-sm); }',
    ].join('\n');
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento('/repo/frontend/src/components/ui/Modal.css'), 'Modal.css');

    assert.strictEqual(violaciones.length, 0);
  });

  test('ignora layout de resumen que no define semantica textual', () => {
    const texto = '.modalCompraResumen { display: flex; gap: var(--spacing-sm); }';
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento('/repo/frontend/src/components/servicios/ModalCompra.css'), 'ModalCompra.css');

    assert.strictEqual(violaciones.length, 0);
  });

  test('respeta sentinel-disable-next-line', () => {
    const texto = [
      '/* sentinel-disable-next-line modal-semantica-no-canonica */',
      '.usuariosModalTexto { color: var(--text-muted); }',
    ].join('\n');
    const violaciones = verificarModalSemanticaNoCanonica(texto, crearDocumento('/repo/frontend/src/components/panel/UsuariosAcciones.css'), 'UsuariosAcciones.css');

    assert.strictEqual(violaciones.length, 0);
  });
});