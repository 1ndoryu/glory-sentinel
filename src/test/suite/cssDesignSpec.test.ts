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
