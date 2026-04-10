import * as assert from 'assert';
import { verificarCssAdhocButtonStyle } from '../../analyzers/static/staticCssRules';

function crearDocumento(fileName: string) {
  return { fileName } as any;
}

suite('css-adhoc-button-style', () => {
  test('detecta clase custom de boton con cursor pointer', () => {
    const texto = '.ctaBotonPrimario { cursor: pointer; }';
    const violaciones = verificarCssAdhocButtonStyle(texto, crearDocumento('/repo/frontend/src/components/ui/SeccionCta.css'), 'SeccionCta.css');
    assert.strictEqual(violaciones.length, 1);
  });

  test('ignora comentarios que mencionan boton si el selector no lo es', () => {
    const texto = '/* Boton Google */\n.modalAccionGoogle { cursor: pointer; }';
    const violaciones = verificarCssAdhocButtonStyle(texto, crearDocumento('/repo/frontend/src/components/layout/ModalAutenticacion.css'), 'ModalAutenticacion.css');
    assert.strictEqual(violaciones.length, 0);
  });

  test('ignora clases base del sistema en selectores compuestos', () => {
    const texto = '.notificationBell .menuContextualBoton.notificationBell__trigger { cursor: pointer; }';
    const violaciones = verificarCssAdhocButtonStyle(texto, crearDocumento('/repo/frontend/src/components/panel/NotificationBell.css'), 'NotificationBell.css');
    assert.strictEqual(violaciones.length, 0);
  });

  test('ignora selector de elemento nativo button sin clase boton custom', () => {
    const texto = 'button.tarjetaBase { cursor: pointer; }';
    const violaciones = verificarCssAdhocButtonStyle(texto, crearDocumento('/repo/frontend/src/components/ui/Tarjeta.css'), 'Tarjeta.css');
    assert.strictEqual(violaciones.length, 0);
  });

  test('ignora framework glory-rs y assets legacy', () => {
    const framework = verificarCssAdhocButtonStyle('.boton { cursor: pointer; }', crearDocumento('/repo/glory-rs/frontend/estilos/Componentes.css'), 'Componentes.css');
    const assets = verificarCssAdhocButtonStyle('.button-primary { cursor: pointer; }', crearDocumento('/repo/frontend/public/assets/css/home.css'), 'home.css');
    assert.strictEqual(framework.length, 0);
    assert.strictEqual(assets.length, 0);
  });
});