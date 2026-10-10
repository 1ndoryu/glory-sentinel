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
    const methods = Array.from({ length: 11 }, (_, index) => `method${index}(input: string): void;`).join('\n');
    const source = `const child = exec(command + input);\ninterface Payload {\n${methods}\n}`;
    const findings = verificarReglasPortables(documentFor('/workspace/src/service.ts', source));
    assert.ok(findings.some(finding => finding.reglaId === 'unsafe-process-shell'));
    assert.ok(findings.some(finding => finding.reglaId === 'large-interface-isp'));
  });

  /* [08AA-26] DTO espejo de API (solo datos, 0 metodos) no viola ISP:
   * dividir ClienteDuena/SesionCliente/AuditoriaFila romperia el contrato
   * 1:1 con el backend. Solo los contratos con comportamiento marcan. */
  test('ignores wide data-only DTO interfaces (no methods)', () => {
    const fields = Array.from({ length: 12 }, (_, index) => `campo${index}: string | null;`).join('\n');
    const source = `/* Fila de GET /api/admin/agent/auditoria. */\nexport interface AuditoriaFila {\n${fields}\n}`;
    const findings = verificarReglasPortables(documentFor('/workspace/src/data/cliente-duena.ts', source));
    assert.strictEqual(findings.some(finding => finding.reglaId === 'large-interface-isp'), false);
  });

  /* [08AA-26] Solo los metodos cuentan: 12 propiedades + 2 metodos no marcan. */
  test('ignores wide interfaces whose members are mostly data fields', () => {
    const fields = Array.from({ length: 12 }, (_, index) => `campo${index}: string;`).join('\n');
    const methods = Array.from({ length: 2 }, (_, index) => `metodo${index}(): void;`).join('\n');
    const source = `export interface Mixto {\n${fields}\n${methods}\n}`;
    const findings = verificarReglasPortables(documentFor('/workspace/src/data/mixto.ts', source));
    assert.strictEqual(findings.some(finding => finding.reglaId === 'large-interface-isp'), false);
  });

  /* [08AA-26] Un unico re-export es alias de compatibilidad (caso
   * ficha-ask.ts), no barrel: solo ≥2 re-exports con logica marcan. */
  test('ignores single compat re-export alongside logic', () => {
    const source = [
      'export function preguntaRespondida(p: unknown): boolean { return true; }',
      "export { calcularCompletitud } from './pasos-ask';",
    ].join('\n');
    const findings = verificarReglasPortables(documentFor('/workspace/src/domain/ficha-ask.ts', source));
    assert.strictEqual(findings.some(finding => finding.reglaId === 'mixed-barrel-logic'), false);
  });

  test('detects barrel mixing multiple re-exports with logic', () => {
    const source = [
      'export function ayudaLocal(): string { return "x"; }',
      "export { a } from './a';",
      "export { b } from './b';",
    ].join('\n');
    const findings = verificarReglasPortables(documentFor('/workspace/src/domain/indice.ts', source));
    assert.ok(findings.some(finding => finding.reglaId === 'mixed-barrel-logic'));
  });
});
