import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeCliTarget, parseCliArgs } from '../../cli';
import { analyzeDocument } from '../../core/analyzeDocument';
import { languageIdForFile } from '../../core/language';
import { CoreFinding, createCoreDocument } from '../../core/types';

interface ExpectedFindingSummary {
  ruleId: string;
  severity: string;
  line: number;
}

interface EquivalenceFixture {
  name: string;
  directory: string;
  fileName: string;
}

const fixtures: EquivalenceFixture[] = [
  { name: 'PHP wpdb sin prepare', directory: 'php-wpdb-sin-prepare', fileName: 'sample.php' },
  { name: 'Rust unwrap produccion', directory: 'rust-unwrap-produccion', fileName: 'sample.rs' },
  { name: 'Rust ruta axum {param}', directory: 'rust-ruta-axum-sintaxis', fileName: 'sample.rs' },
  { name: 'React Zustand selector', directory: 'react-zustand-selector', fileName: 'StorePanel.tsx' },
];

function resumirFindings(findings: CoreFinding[], expectedRuleIds: Set<string>): ExpectedFindingSummary[] {
  return findings
    .filter(finding => expectedRuleIds.has(finding.ruleId))
    .map(finding => ({
      ruleId: finding.ruleId,
      severity: finding.severity,
      line: finding.range.start.line,
    }))
        /* [297A-14] Orden numerico por linea para hallazgos de la misma regla:
     * localeCompare sobre `ruleId:line` compara cadenas y "10" < "9"
     * (bug latente que invertia fixtures con 2+ hallazgos de la misma regla). */
    .sort((a, b) => (a.ruleId === b.ruleId ? a.line - b.line : a.ruleId.localeCompare(b.ruleId)));
}

suite('Sentinel equivalencia core vs CLI', () => {
  for (const fixture of fixtures) {
    test(fixture.name, async () => {
      const fixtureRoot = path.join(process.cwd(), 'fixtures', 'equivalence', fixture.directory);
      const inputPath = path.join(fixtureRoot, fixture.fileName);
      const expectedPath = path.join(fixtureRoot, 'expected-findings.json');
      const content = fs.readFileSync(inputPath, 'utf8');
      const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8')) as ExpectedFindingSummary[];
      const expectedRuleIds = new Set(expected.map(finding => finding.ruleId));

      const document = createCoreDocument({
        uri: `file://${inputPath.replace(/\\/g, '/')}`,
        fileName: inputPath,
        languageId: languageIdForFile(inputPath),
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

      assert.deepStrictEqual(resumirFindings(coreFindings, expectedRuleIds), expected);
      assert.deepStrictEqual(resumirFindings(cliFindings, expectedRuleIds), expected);
    });
  }
});