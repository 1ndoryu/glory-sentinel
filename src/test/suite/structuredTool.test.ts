/* [028A-6 Fase 1] Tests del contrato estructurado de herramientas (extraído
 * de scripts/quality/tests/structured-tool.test.mjs): reporte versionado y
 * estados tool-error/timeout/cancelled/invalid-output distinguibles. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runStructuredTool, StructuredToolOptions } from '../../core/structuredTool';

function optionsFor(root: string, isCancelled?: () => boolean): StructuredToolOptions {
  const logs = path.join(root, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  return { projectRoot: root, reportRoot: root, logsRoot: logs, isCancelled };
}

suite('Sentinel core structured tool (orquestador agnóstico)', () => {
  test('describe un reporte versionado', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-structured-adapter-'));
    try {
      const outcome = await runStructuredTool({
        name: 'structured-test',
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("ok")'],
        reportPath: path.join(root, 'missing-structured-report.json'),
        expectedSchemaVersion: '1',
        timeoutMs: 2000,
      }, optionsFor(root));
      assert.strictEqual(outcome.status, 'error');
      assert.strictEqual(outcome.state, 'invalid-output');
      assert.strictEqual(outcome.findings[0].ruleId, 'quality-invalid-output');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('conserva cancelled como estado distinto de tool-error', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-structured-cancelled-'));
    try {
      const outcome = await runStructuredTool({
        name: 'cancelled',
        executable: process.execPath,
        args: ['-e', 'setTimeout(() => process.exit(0), 50)'],
        reportPath: path.join(root, 'cancelled.json'),
        expectedSchemaVersion: '1',
        timeoutMs: 2000,
      }, optionsFor(root, () => true));
      assert.strictEqual(outcome.state, 'cancelled');
      assert.strictEqual(outcome.status, 'error');
      assert.strictEqual(outcome.findings[0].ruleId, 'quality-cancelled');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('distingue tool-error, timeout, reporte válido y finding inválido', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-structured-states-'));
    const options = optionsFor(root);
    try {
      const toolError = await runStructuredTool({
        name: 'tool-error',
        executable: process.execPath,
        args: ['-e', 'process.exit(2)'],
        reportPath: path.join(root, 'error.json'),
        expectedSchemaVersion: '1',
        timeoutMs: 2000,
      }, options);
      assert.strictEqual(toolError.state, 'tool-error');

      const timeout = await runStructuredTool({
        name: 'timeout',
        executable: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        reportPath: path.join(root, 'timeout.json'),
        expectedSchemaVersion: '1',
        timeoutMs: 50,
      }, options);
      assert.strictEqual(timeout.state, 'timeout');

      fs.writeFileSync(path.join(root, 'valid.json'), JSON.stringify({ schemaVersion: 1, entries: [] }), 'utf8');
      const valid = await runStructuredTool({
        name: 'valid',
        executable: process.execPath,
        args: ['-e', ''],
        reportPath: path.join(root, 'valid.json'),
        expectedSchemaVersion: '1',
        timeoutMs: 2000,
      }, options);
      assert.strictEqual(valid.status, 'pass');
      assert.strictEqual(valid.state, 'pass');

      fs.writeFileSync(path.join(root, 'bad-finding.json'), JSON.stringify({
        schemaVersion: 1,
        entries: [{ findings: [{ ruleId: 'x', severity: 'unknown', message: 'bad' }] }],
      }), 'utf8');
      const invalidFinding = await runStructuredTool({
        name: 'invalid-finding',
        executable: process.execPath,
        args: ['-e', ''],
        reportPath: path.join(root, 'bad-finding.json'),
        expectedSchemaVersion: '1',
        timeoutMs: 2000,
      }, options);
      assert.strictEqual(invalidFinding.state, 'invalid-output');

      fs.writeFileSync(path.join(root, 'findings.json'), JSON.stringify({
        schemaVersion: 1,
        entries: [{ findings: [{ ruleId: 'x', severity: 'error', message: 'boom' }] }],
      }), 'utf8');
      const fail = await runStructuredTool({
        name: 'findings',
        executable: process.execPath,
        args: ['-e', ''],
        reportPath: path.join(root, 'findings.json'),
        expectedSchemaVersion: '1',
        timeoutMs: 2000,
      }, options);
      assert.strictEqual(fail.status, 'fail');
      assert.strictEqual(fail.findings[0].severity, 'error');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
