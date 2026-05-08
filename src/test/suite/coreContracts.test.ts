import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createCoreDocument, createCoreRange, serializeCoreFindings, CoreFinding } from '../../core/types';
import { findingToDiagnostic } from '../../core/vscodeAdapter';
import { analyzeDocument } from '../../core/analyzeDocument';
import { generarReporteMarkdown } from '../../core/report';
import { analyzeCliTarget, languageIdForFile, parseCliArgs } from '../../cli';

suite('Sentinel editor-agnostic core contracts', () => {
  test('creates a document with stable line helpers', () => {
    const document = createCoreDocument({
      uri: 'file:///workspace/src/main.rs',
      fileName: '/workspace/src/main.rs',
      languageId: 'rust',
      content: 'fn main() {\n  println!("ok");\n}',
    });

    assert.strictEqual(document.lineCount, 3);
    assert.strictEqual(document.lineAt(1).text, '  println!("ok");');
    assert.strictEqual(document.getText().includes('main'), true);
  });

  test('serializes findings without editor-specific objects', () => {
    const finding: CoreFinding = {
      ruleId: 'sentinel-test-rule',
      message: 'Problema de prueba',
      severity: 'error',
      source: 'Code Sentinel',
      range: createCoreRange(2, 4, 2, 16),
      suggestion: 'Usar una abstraccion compartida',
    };

    const parsed = JSON.parse(serializeCoreFindings([finding])) as CoreFinding[];

    assert.strictEqual(parsed[0].ruleId, finding.ruleId);
    assert.strictEqual(parsed[0].range.start.line, 2);
    assert.strictEqual(parsed[0].severity, 'error');
  });

  test('maps core findings to VS Code diagnostics at the boundary', () => {
    const diagnostic = findingToDiagnostic({
      ruleId: 'sentinel-boundary-rule',
      message: 'Hallazgo convertido',
      severity: 'warning',
      source: 'Code Sentinel',
      range: createCoreRange(0, 1, 0, 10),
    });

    assert.strictEqual(diagnostic.code, 'sentinel-boundary-rule');
    assert.strictEqual(diagnostic.source, 'Code Sentinel');
    assert.strictEqual(diagnostic.range.start.line, 0);
    assert.strictEqual(diagnostic.range.start.character, 1);
  });

  test('analyzes a document through the editor-agnostic core', () => {
    const document = createCoreDocument({
      uri: 'file:///workspace/src/secret.ts',
      fileName: '/workspace/src/secret.ts',
      languageId: 'typescript',
      content: 'const password = "abcd1234";',
    });

    const findings = analyzeDocument(document, {
      enabled: true,
      includePatterns: [],
      excludePatterns: [],
      ruleOverrides: {},
    });

    assert.ok(findings.some(finding => finding.ruleId === 'hardcoded-secret'));
    assert.strictEqual(findings[0].source, 'Code Sentinel');
  });

  test('generates workspace reports without editor objects', () => {
    const markdown = generarReporteMarkdown({
      totalArchivos: 2,
      rutaBase: '/workspace',
      fecha: new Date('2026-05-08T10:30:00Z'),
      entries: [{
        ruta: '/workspace/src/app.ts',
        findings: [{
          ruleId: 'hardcoded-secret',
          message: 'Secret | detectado',
          severity: 'error',
          range: createCoreRange(2, 4, 2, 18),
          source: 'Code Sentinel',
        }],
      }],
    });

    assert.ok(markdown.includes('**Total violaciones:** 1'));
    assert.ok(markdown.includes('## src/app.ts (1 violaciones)'));
    assert.ok(markdown.includes('Secret \\| detectado'));
  });

  test('parses CLI analyze arguments', () => {
    const args = parseCliArgs(['analyze', '--file', 'src/app.ts', '--format', 'json']);

    assert.strictEqual(args.command, 'analyze');
    assert.strictEqual(args.filePath, 'src/app.ts');
    assert.strictEqual(args.format, 'json');
  });

  test('maps file extensions to language ids for CLI documents', () => {
    assert.strictEqual(languageIdForFile('src/App.tsx'), 'typescriptreact');
    assert.strictEqual(languageIdForFile('src/lib.rs'), 'rust');
  });

  test('analyzes a workspace through the CLI core path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-cli-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'secret.ts'), 'const password = "abcd1234";');

    try {
      const result = await analyzeCliTarget(parseCliArgs(['analyze', '--workspace', root, '--format', 'json']));

      assert.strictEqual(result.totalArchivos, 1);
      assert.ok(result.hasErrors);
      assert.ok(result.entries[0].findings.some(finding => finding.ruleId === 'hardcoded-secret'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
