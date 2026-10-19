import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CoreTextDocument } from '../../core/types';
import { verificarCssEspecificacionDisenoLocal } from '../../analyzers/static/staticCssRules';
import { analizarDocumento } from '../../analyzers/pipeline';
import { createCoreDocument, CoreFinding } from '../../core/types';
import { analyzeCliTarget, parseCliArgs } from '../../cli';

interface ExpectedFindingSummary {
  ruleId: string;
  severity: string;
  line: number;
}

function crearDocumento(fileName: string) {
  return { fileName } as CoreTextDocument;
}

function resumirFindings(findings: CoreFinding[]): ExpectedFindingSummary[] {
  return findings
    .filter(finding => finding.ruleId === 'css-especificacion-diseno-local')
    .map(finding => ({
      ruleId: finding.ruleId,
      severity: finding.severity,
      line: finding.range.start.line,
    }));
}

suite('css-especificacion-diseno-local', () => {
  test('detecta trigger y submenu local aunque no contengan boton/button', () => {
    const texto = [
      '.selectorIdiomaTrigger {',
      '  background: transparent;',
      '  border: none;',
      '  color: var(--text-dark);',
      '  padding: 4px 8px;',
      '  border-radius: var(--radius-sm);',
      '  cursor: pointer;',
      '  font-size: var(--text-sm);',
      '}',
      '',
      '.selectorIdiomaLista::before {',
      "  content: '';",
      '  background-color: var(--brand-white);',
      '  border: 1px solid var(--bg-card-subtle);',
      '  border-radius: var(--radius-md);',
      '  animation: selectorIdiomaEntrada 0.15s ease-out;',
      '}',
    ].join('\n');

    const violaciones = verificarCssEspecificacionDisenoLocal(
      texto,
      crearDocumento('/repo/frontend/src/components/ui/LanguageSelector.css'),
      'LanguageSelector.css'
    );

    assert.strictEqual(violaciones.length, 2);
    assert.ok(violaciones.some(violacion => violacion.mensaje.includes('.selectorIdiomaTrigger')));
    assert.ok(violaciones.some(violacion => violacion.mensaje.includes('.selectorIdiomaLista')));
  });

  test('ignora la receta canonica ContextMenu.css', () => {
    const texto = '.menuContextualPanel { background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: var(--radius-lg); }';
    const violaciones = verificarCssEspecificacionDisenoLocal(
      texto,
      crearDocumento('/repo/frontend/src/components/ui/ContextMenu.css'),
      'ContextMenu.css'
    );

    assert.strictEqual(violaciones.length, 0);
  });

  test('[229A-1] ignora panel decorativo con border-radius 50% (geometria, no diseno)', () => {
    const texto = [
      '.vpsOrbitPanel {',
      '  width: 454px;',
      '  height: 454px;',
      '  background: radial-gradient(circle at 50% 50%, var(--vpsColorResplandor) 0%, transparent 65%);',
      '  border-radius: 50%;',
      '}',
    ].join('\n');

    const violaciones = verificarCssEspecificacionDisenoLocal(
      texto,
      crearDocumento('/repo/gui/src/estilos/portal-secciones.css'),
      'portal-secciones.css'
    );

    assert.strictEqual(violaciones.length, 0);
  });

  test('[229A-1] mismo panel con radio literal si dispara (control)', () => {
    const texto = '.vpsOrbitPanel { background: radial-gradient(circle, var(--a) 0%, transparent 65%); border-radius: 8px; }';

    const violaciones = verificarCssEspecificacionDisenoLocal(
      texto,
      crearDocumento('/repo/gui/src/estilos/portal-secciones.css'),
      'portal-secciones.css'
    );

    assert.strictEqual(violaciones.length, 1);
  });

  test('respeta sentinel-disable-next-line', () => {
    const texto = [
      '/* sentinel-disable-next-line css-especificacion-diseno-local */',
      '.selectorIdiomaTrigger { background: transparent; border: none; color: var(--text-dark); padding: 4px 8px; }',
    ].join('\n');

    const violaciones = verificarCssEspecificacionDisenoLocal(
      texto,
      crearDocumento('/repo/frontend/src/components/ui/LanguageSelector.css'),
      'LanguageSelector.css'
    );

    assert.strictEqual(violaciones.length, 0);
  });

  /* [15A-25] Cuatro criterios que la regla no tenia y que producian ~33 de los 93
   * hallazgos de KAMPLES. Cada uno con su control, para que el test no pueda pasar
   * por estar la regla muda. */
  test('[15A-25] el sujeto del selector manda: el ancestro no es el culpable', () => {
    const soloAncestro = '.tarjetaColeccionLista .tarjetaColeccionPortada img { border-radius: var(--radioSm); padding: 4px; }';
    const control = '.tarjetaColeccionLista { border-radius: var(--radioSm); padding: 6px 10px; cursor: pointer; }';

    const vAncestro = verificarCssEspecificacionDisenoLocal(
      soloAncestro,
      crearDocumento('/repo/frontend/src/components/coleccion/TarjetaColeccion.css'),
      'TarjetaColeccion.css'
    );
    const vControl = verificarCssEspecificacionDisenoLocal(
      control,
      crearDocumento('/repo/frontend/src/components/coleccion/TarjetaColeccion.css'),
      'TarjetaColeccion.css'
    );

    assert.strictEqual(vAncestro.length, 0);
    assert.strictEqual(vControl.length, 1);
  });

  test('[15A-25] un modificador sobre una receta del sistema no la reimplementa', () => {
    const texto = '.botonBase.eliminarItem { background: var(--bg-danger); border-radius: var(--radioSm); }';

    const violaciones = verificarCssEspecificacionDisenoLocal(
      texto,
      crearDocumento('/repo/frontend/src/components/panel/Usuarios.css'),
      'Usuarios.css'
    );

    assert.strictEqual(violaciones.length, 0);
  });

  test('[15A-25] la hoja que define la clase es su receta', () => {
    const texto = '.dropdownPanel { background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: var(--radioLg); }';

    const enSuHoja = verificarCssEspecificacionDisenoLocal(
      texto,
      crearDocumento('/repo/frontend/src/components/ui/dropdownPanel.css'),
      'dropdownPanel.css'
    );
    const enOtraHoja = verificarCssEspecificacionDisenoLocal(
      texto,
      crearDocumento('/repo/frontend/src/components/panel/Portal.css'),
      'Portal.css'
    );

    assert.strictEqual(enSuHoja.length, 0);
    assert.strictEqual(enOtraHoja.length, 1);
  });

  test('[15A-25] una fila no es un control si no declara gesto; una superficie si', () => {
    const filaSinGesto = '.usuariosListaItem { border-radius: var(--radioSm); padding: 6px 10px; }';
    const filaConGesto = '.usuariosListaItem { border-radius: var(--radioSm); padding: 6px 10px; cursor: pointer; }';
    /* La superficie flotante posee su receta por forma, sin gesto propio: el gesto
     * esta en abrirse, cerrarse y posicionarse. */
    const superficieSinGesto = '.panelFiltrosDropdown { background: var(--bg-primary); border-radius: var(--radioMd); }';

    const verificar = (texto: string) => verificarCssEspecificacionDisenoLocal(
      texto,
      crearDocumento('/repo/frontend/src/components/panel/Usuarios.css'),
      'Usuarios.css'
    );

    assert.strictEqual(verificar(filaSinGesto).length, 0);
    assert.strictEqual(verificar(filaConGesto).length, 1);
    assert.strictEqual(verificar(superficieSinGesto).length, 1);
  });

  test('[15A-26] el remedio solo se prescribe donde es aplicable', () => {
    /* El mensaje de la regla dice "usa una receta compartida como Button/ContextMenu/
     * dropdown canonico". Se comprueba con el indice del proyecto a que elemento se
     * aplica la clase: si es una fila de <div> que no se opera y no declara superficie,
     * no hay receta a la que plegarse y el hallazgo seria ruido. */
    /* Un proyecto minimo por caso: el indice se cachea por conjunto de roots, asi que
     * reutilizar la carpeta haria que el caso 2 viera el JSX del caso 1. */
    const enProyecto = (jsx: string, texto: string): number => {
      const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-ds-'));
      const rutaJsx = path.join(raiz, 'src', 'ui', 'Fila.tsx');
      fs.mkdirSync(path.dirname(rutaJsx), { recursive: true });
      fs.writeFileSync(rutaJsx, jsx, 'utf8');
      const violaciones = verificarCssEspecificacionDisenoLocal(
        texto,
        crearDocumento(path.join(raiz, 'src', 'ui', 'Lista.css')),
        'Lista.css',
        [raiz]
      );
      fs.rmSync(raiz, { recursive: true, force: true });
      return violaciones.length;
    };

    const fila = '.filaListaItem {\n  display: flex;\n  border-radius: var(--radioSm);\n  cursor: pointer;\n  transition: background-color 0.15s;\n}';
    const superficie = '.panelFiltrosDropdown {\n  background: var(--bg-primary);\n  border: 1px solid var(--bordeSutil);\n  border-radius: var(--radioMd);\n  box-shadow: var(--sombraElevada);\n}';

    /* 1. La fila no es un control: el <div> no se opera. */
    assert.strictEqual(
      enProyecto('export const Fila = () => <div className="filaListaItem"><span>hola</span></div>;\n', fila),
      0,
      'fila de <div> sin operar no debe disparar'
    );

    /* 2. El mismo bloque sobre un CONTROL nativo si es un hallazgo. */
    assert.strictEqual(
      enProyecto('export const Fila = () => <button className="filaListaItem">hola</button>;\n', fila),
      1,
      'un <button> si lleva receta de boton local'
    );

    /* 3. Un componente del sistema (<BotonBase>) tambien. */
    assert.strictEqual(
      enProyecto('export const Fila = () => <BotonBase className="filaListaItem">hola</BotonBase>;\n', fila),
      1,
      'un componente del sistema si lleva receta local'
    );

    /* 4. Un <div> que SE OPERA es un boton de facto. */
    assert.strictEqual(
      enProyecto('export const Fila = () => <div className="filaListaItem" onClick={ir}>hola</div>;\n', fila),
      1,
      'un <div onClick> es un boton de facto'
    );

    /* 5. Sobre un <div> llano, pero con la firma de superficie flotante. */
    assert.strictEqual(
      enProyecto('export const Fila = () => <div className="panelFiltrosDropdown" />;\n', superficie),
      1,
      'la firma de superficie si dispara sobre un <div>'
    );

    /* 6. FAIL-CLOSED: sin roots no hay indice, y la falta de evidencia no exime. */
    const sinIndice = verificarCssEspecificacionDisenoLocal(
      fila,
      crearDocumento('/repo/frontend/src/components/ui/Lista.css'),
      'Lista.css'
    );
    assert.strictEqual(sinIndice.length, 1, 'sin indice se cae al veredicto de siempre');
  });

  test('[15A-26] sobre un componente, solo layout contextual no es reimplementar la receta', () => {
    /* El mensaje de la regla dice "deja aqui solo layout contextual". Si el elemento
     * ya es un <BotonBase> y el bloque no re-declara nada de la receta, el autor ha
     * hecho exactamente lo que se le pide: marcarlo lo dejaria sin salida. */
    const enProyecto = (jsx: string, texto: string): number => {
      const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-ds-'));
      const rutaJsx = path.join(raiz, 'src', 'ui', 'Fila.tsx');
      fs.mkdirSync(path.dirname(rutaJsx), { recursive: true });
      fs.writeFileSync(rutaJsx, jsx, 'utf8');
      const violaciones = verificarCssEspecificacionDisenoLocal(
        texto,
        crearDocumento(path.join(raiz, 'src', 'ui', 'Lista.css')),
        'Lista.css',
        [raiz]
      );
      fs.rmSync(raiz, { recursive: true, force: true });
      return violaciones.length;
    };

    const componente = 'export const Fila = () => <BotonBase variante="ghost" className="filaListaItem">hola</BotonBase>;\n';

    /* Solo layout contextual: la receta ya esta en uso. */
    assert.strictEqual(
      enProyecto(componente, '.filaListaItem { padding: var(--espacioXs) var(--espacioSm); text-align: left; }'),
      0,
      'layout contextual sobre un componente no debe disparar'
    );

    /* Re-declara la receta: sigue siendo un hallazgo. */
    assert.strictEqual(
      enProyecto(componente, '.filaListaItem { padding: var(--espacioXs); background: var(--fondoElevado2); color: var(--textoPrimario); }'),
      1,
      're-declarar fondo y color si es reimplementar la receta'
    );

    /* Un control nativo no tiene receta a la que plegarse: sigue disparando. */
    assert.strictEqual(
      enProyecto('export const Fila = () => <button className="filaListaItem">hola</button>;\n', '.filaListaItem { padding: var(--espacioXs); text-align: left; }'),
      1,
      'un <button> nativo sigue siendo un hallazgo aunque solo ajuste layout'
    );
  });

  test('[15A-26] la hoja del dropdown canonico es una hoja de receta', () => {
    /* .dropdownItem vive en dropdownPanel.css junto a .dropdownPanel: es la receta
     * que la regla prescribe, no una reimplementacion. Mismo criterio que
     * contextmenu.css. */
    const texto = '.dropdownItem { display: flex; cursor: pointer; border: none; background: none; width: 100%; padding: var(--espacioXs) var(--espacioSm); border-radius: var(--radioMd); }';
    const enSuHoja = verificarCssEspecificacionDisenoLocal(
      texto,
      crearDocumento('/repo/frontend/src/styles/dropdownPanel.css'),
      'dropdownPanel.css'
    );
    const enOtraHoja = verificarCssEspecificacionDisenoLocal(
      texto,
      crearDocumento('/repo/frontend/src/components/panel/Portal.css'),
      'Portal.css'
    );

    assert.strictEqual(enSuHoja.length, 0);
    assert.strictEqual(enOtraHoja.length, 1);
  });

  test('fixture de equivalencia core vs CLI detecta el selector de idioma', async () => {
    const fixtureRoot = path.join(process.cwd(), 'fixtures', 'equivalence', 'language-selector-design-spec');
    const inputPath = path.join(fixtureRoot, 'LanguageSelector.css');
    const expectedPath = path.join(fixtureRoot, 'expected-findings.json');
    const content = fs.readFileSync(inputPath, 'utf8');
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8')) as ExpectedFindingSummary[];

    const document = createCoreDocument({
      uri: `file://${inputPath.replace(/\\/g, '/')}`,
      fileName: inputPath,
      languageId: 'css',
      content,
    });

    const coreFindings = analizarDocumento(document, {
      enabled: true,
      includePatterns: [],
      excludePatterns: [],
      ruleOverrides: {},
    });
    const cliResult = await analyzeCliTarget(parseCliArgs(['analyze', '--file', inputPath, '--format', 'json']));
    const cliFindings = cliResult.entries.flatMap(entry => entry.findings);

    assert.deepStrictEqual(resumirFindings(coreFindings), expected);
    assert.deepStrictEqual(resumirFindings(cliFindings), expected);
  });

  test('[15A-27] un contenedor de layout llamado ...Panel no es una superficie', () => {
    /* El nombre de familia abre la puerta, pero no decide: el bloque tiene que
     * pintarse como superficie. Este es un contenedor de contenido (padding, flex,
     * tipografia) sin fondo ni limite: no hay receta a la que plegarlo. */
    const contenedor = [
      '.diagSyncPanel {',
      '  padding: var(--espacioMd);',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: var(--espacioMd);',
      '  font-size: var(--fuenteSm);',
      '  color: var(--textoSecundario);',
      '  overflow-y: auto;',
      '  max-height: 400px;',
      '}',
    ].join('\n');

    const violaciones = verificarCssEspecificacionDisenoLocal(
      contenedor,
      crearDocumento('/repo/frontend/src/styles/diagnosticoSync.css'),
      'diagnosticoSync.css'
    );

    assert.strictEqual(violaciones.length, 0);
  });

  test('[15A-27] el sujeto no es la clase cuando el selector es un pseudo de proveedor', () => {
    /* `.dropdown::-webkit-scrollbar-thumb` estiliza una pieza interna del
     * navegador, no la piel del dropdown: no reimplementa su receta. */
    const barra = [
      '.busquedaRapidaDropdown::-webkit-scrollbar-thumb {',
      '  background: var(--bordeSutil);',
      '  border-radius: var(--radioSm);',
      '}',
    ].join('\n');

    const violaciones = verificarCssEspecificacionDisenoLocal(
      barra,
      crearDocumento('/repo/frontend/src/styles/busquedaRapida.css'),
      'busquedaRapida.css'
    );

    assert.strictEqual(violaciones.length, 0);
  });

  test('[15A-27] testigo: un pseudo de contenido si es el sujeto de la clase', () => {
    /* `::before`/`::after` si crean decoracion propia del elemento, y eso es
     * especificacion local. Sin este testigo el anterior pasaria por no mirar. */
    const decoracion = '.panelFiltrosDropdown::after { background: var(--fondoElevado1); border-radius: var(--radioMd); }';

    const violaciones = verificarCssEspecificacionDisenoLocal(
      decoracion,
      crearDocumento('/repo/frontend/src/styles/busquedaRapida.css'),
      'busquedaRapida.css'
    );

    assert.strictEqual(violaciones.length, 1);
  });

  test('[15A-27] testigo: un ...Panel que si se pinta sigue siendo un hallazgo', () => {
    /* Sin este testigo el anterior pasaria por no mirar. Se cubren las dos formas
     * de limite y se omite box-shadow a proposito: exigir elevacion dejaria ciego
     * al panel flotante embebido, que es legitimo. */
    const conBorde = [
      '.avisoPanel {',
      '  background: var(--fondoElevado1);',
      '  border: 1px solid var(--bordeSutil);',
      '  padding: var(--espacioMd);',
      '  color: var(--textoSecundario);',
      '}',
    ].join('\n');
    const conRadio = [
      '.tarjetaPanel {',
      '  background-color: var(--fondoElevado1);',
      '  border-radius: var(--radioMd);',
      '  padding: var(--espacioMd);',
      '  color: var(--textoSecundario);',
      '}',
    ].join('\n');

    const sinBordeNiRadio = [
      '.soloFondoPanel {',
      '  background: var(--fondoElevado1);',
      '  padding: var(--espacioMd);',
      '  color: var(--textoSecundario);',
      '}',
    ].join('\n');

    assert.strictEqual(
      verificarCssEspecificacionDisenoLocal(conBorde, crearDocumento('/repo/a.css'), 'a.css').length,
      1
    );
    assert.strictEqual(
      verificarCssEspecificacionDisenoLocal(conRadio, crearDocumento('/repo/b.css'), 'b.css').length,
      1
    );
    /* Un fondo suelto no es una superficie: sin limite no hay piel que plegar. */
    assert.strictEqual(
      verificarCssEspecificacionDisenoLocal(sinBordeNiRadio, crearDocumento('/repo/c.css'), 'c.css').length,
      0
    );
  });
});
