import * as assert from 'assert';
import { createCoreDocument, createCoreRange, serializeCoreFindings, CoreFinding } from '../../core/types';
import { findingToDiagnostic } from '../../core/vscodeAdapter';
import { analyzeDocument } from '../../core/analyzeDocument';

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
});
