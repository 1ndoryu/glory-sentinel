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

  /* [317A-3] La receta .boton-icono (solo icono) es parte del sistema de diseño,
   * no un boton ad-hoc: no debe reportarse. Regresión de allowlist CLASES_BOTON_SISTEMA. */
  test('ignora la receta del sistema boton-icono y sus variantes kebab', () => {
    const icono = verificarCssAdhocButtonStyle('.boton-icono { cursor: pointer; }', crearDocumento('/repo/frontend/src/styles/components.css'), 'components.css');
    const pequeno = verificarCssAdhocButtonStyle('.boton-pequeno { cursor: pointer; }', crearDocumento('/repo/frontend/src/styles/components.css'), 'components.css');
    const grande = verificarCssAdhocButtonStyle('.boton-grande { cursor: pointer; }', crearDocumento('/repo/frontend/src/styles/components.css'), 'components.css');
    assert.strictEqual(icono.length, 0);
    assert.strictEqual(pequeno.length, 0);
    assert.strictEqual(grande.length, 0);
  });

  /* [15A-27] La exencion de arriba solo miraba el nombre problematico, no la
   * composicion: `.botonBase.controlBloque` no se reportaba y
   * `.botonBase.pageBuilderTipoBoton` si, con el mismo cuerpo. Si el selector
   * compone con una clase base del sistema, el bloque es una variante de esa
   * base. */
  test('ignora un modificador que compone con la clase base del sistema', () => {
    const texto = '.botonBase.pageBuilderTipoBoton { cursor: pointer; background: #1a1a1a; }';
    const violaciones = verificarCssAdhocButtonStyle(texto, crearDocumento('/repo/frontend/src/glory-core/pageBuilder/styles/constructorPaginas.css'), 'constructorPaginas.css');
    assert.strictEqual(violaciones.length, 0);
  });

  test('sigue reportando el boton ad-hoc que no compone con la base', () => {
    const texto = '.pageBuilderTipoBoton { cursor: pointer; background: #1a1a1a; }';
    const violaciones = verificarCssAdhocButtonStyle(texto, crearDocumento('/repo/frontend/src/glory-core/pageBuilder/styles/constructorPaginas.css'), 'constructorPaginas.css');
    assert.strictEqual(violaciones.length, 1);
  });
});