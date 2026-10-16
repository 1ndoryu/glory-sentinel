import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { verificarCssEspecificacionDisenoLocal } from '../../analyzers/static/staticCssRules';
import { analyzeDocument } from '../../core/analyzeDocument';
import { createCoreDocument, CoreFinding } from '../../core/types';
import { analyzeCliTarget, parseCliArgs } from '../../cli';

interface ExpectedFindingSummary {
  ruleId: string;
  severity: string;
  line: number;
}

function crearDocumento(fileName: string) {
  return { fileName } as any;
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

    const coreFindings = analyzeDocument(document, {
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
});
