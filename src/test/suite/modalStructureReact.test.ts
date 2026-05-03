import * as assert from 'assert';
import { verificarModalEstructuraNoCanonica } from '../../analyzers/react/reactComponentRules';

suite('modal-estructura-no-canonica', () => {
  test('detecta formulario local dentro de archivo modal', () => {
    const violaciones = verificarModalEstructuraNoCanonica([
      '<form className="agregarTarjetaFormulario" onSubmit={handleSubmit}>',
    ], 'AddPaymentMethodModal.tsx');

    assert.strictEqual(violaciones.length, 1);
    assert.strictEqual(violaciones[0]?.reglaId, 'modal-estructura-no-canonica');
    assert.match(violaciones[0]?.mensaje || '', /modalFormulario/);
  });

  test('detecta campo local dentro de archivo modal', () => {
    const violaciones = verificarModalEstructuraNoCanonica([
      '<div className="usuariosCrearCampo">',
    ], 'ModalCrearUsuario.tsx');

    assert.strictEqual(violaciones.length, 1);
    assert.match(violaciones[0]?.mensaje || '', /modalCampo/);
  });

  test('detecta FormCrear dentro de componente no modal', () => {
    const violaciones = verificarModalEstructuraNoCanonica([
      '<form className="hostingFormCrear" onSubmit={handleSubmit}>',
    ], 'HostingCreateForm.tsx');

    assert.strictEqual(violaciones.length, 1);
    assert.match(violaciones[0]?.mensaje || '', /modalFormulario/);
  });

  test('ignora clases canonicas', () => {
    const violaciones = verificarModalEstructuraNoCanonica([
      '<form className="modalFormulario" onSubmit={handleSubmit}>',
      '<div className="modalCampo">',
    ], 'ModalAutenticacion.tsx');

    assert.strictEqual(violaciones.length, 0);
  });

  test('ignora campo fuera de contexto modal', () => {
    const violaciones = verificarModalEstructuraNoCanonica([
      '<div className="editorMiembroCampo">',
    ], 'EditorMiembro.tsx');

    assert.strictEqual(violaciones.length, 0);
  });

  test('respeta sentinel-disable-next-line', () => {
    const violaciones = verificarModalEstructuraNoCanonica([
      '/* sentinel-disable-next-line modal-estructura-no-canonica */',
      '<form className="hostingFormCrear" onSubmit={handleSubmit}>',
    ], 'HostingCreateForm.tsx');

    assert.strictEqual(violaciones.length, 0);
  });
});