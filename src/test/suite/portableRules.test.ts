import * as assert from 'assert';
import { createCoreDocument } from '../../core/types';
import { verificarReglasPortables } from '../../analyzers/static/portableRules';
import { configurarOverridesReglas } from '../../config/ruleRegistry';

function documentFor(fileName: string, content: string) {
  return createCoreDocument({
    uri: `file://${fileName}`,
    fileName,
    languageId: fileName.endsWith('.tsx') ? 'typescriptreact' : 'typescript',
    content,
  });
}

suite('Portable architecture rules', () => {
  setup(() => configurarOverridesReglas({
    'default-export': { habilitada: true },
  }));

  test('detects DOM access outside configured boundary', () => {
    const findings = verificarReglasPortables(documentFor('/workspace/src/view.ts', 'document.querySelector("main");'));
    assert.ok(findings.some(finding => finding.reglaId === 'dom-access-outside-platform'));
  });

  test('allows DOM access inside platform boundary', () => {
    const findings = verificarReglasPortables(documentFor('/workspace/src/platform/dom.ts', 'document.querySelector("main");'));
    assert.strictEqual(findings.some(finding => finding.reglaId === 'dom-access-outside-platform'), false);
  });

  test('detects unsafe shell and large interfaces', () => {
    const fields = Array.from({ length: 11 }, (_, index) => `field${index}: string;`).join('\n');
    const source = `const child = exec(command + input);\ninterface Payload {\n${fields}\n}`;
    const findings = verificarReglasPortables(documentFor('/workspace/src/service.ts', source));
    assert.ok(findings.some(finding => finding.reglaId === 'unsafe-process-shell'));
    assert.ok(findings.some(finding => finding.reglaId === 'large-interface-isp'));
  });
});
