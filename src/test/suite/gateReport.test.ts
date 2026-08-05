/* [028A-6 Fase 1] Tests del reporte combinado agnóstico (extraído del
 * orquestador scripts/quality). El contrato compacto (3 hallazgos / 4
 * recordatorios), el orden estable y la redacción de secretos deben
 * permanecer deterministas para la migración del gate. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compactLines, createReport, GateReportResult } from '../../core/gateReport';

suite('Sentinel core gate report (orquestador agnóstico)', () => {
  test('la salida compacta conserva estado, siguiente accion y limite de contexto', () => {
    const reportResult = {
      markdownPath: 'C:/repo/.quality-reports/T-1/latest.md',
      report: {
        taskId: 'T-1',
        decision: { label: 'FAIL' },
        scope: { full: true, executionFull: false, files: ['a.ts'] },
        stages: Array.from({ length: 5 }, (_, index) => ({
          stage: `stage-${index}`,
          status: index === 0 ? 'fail' : 'pass',
          cached: false,
          summary: 'resumen',
        })),
        findings: Array.from({ length: 20 }, (_, index) => ({
          severity: 'error', ruleId: `R${index}`, message: 'hallazgo',
        })),
        reminders: ['uno', 'dos', 'tres', 'cuatro'],
        nextCommand: 'sentinel check T-1',
      },
    } as unknown as GateReportResult;
    const context = { projectRoot: 'C:/repo', qualityConfig: { maxFindings: 3 } };
    const lines = compactLines(reportResult, context);

    assert.ok(lines.length <= 16);
    assert.match(lines[0], /T-1 — FAIL/);
    assert.match(lines[1], /full · ejecución incremental/);
    assert.strictEqual(lines.filter(line => line.includes('hallazgo')).length, 3);
    assert.match(lines.at(-1) ?? '', /Next: sentinel check/);
  });

  test('la salida compacta respeta maxReminders además de maxFindings', () => {
    const reportResult = {
      markdownPath: 'C:/repo/.quality-reports/T-3/latest.md',
      report: {
        taskId: 'T-3',
        decision: { label: 'PASS' },
        scope: { full: false, files: ['a.ts'] },
        stages: [{ stage: 'sentinel', status: 'pass', summary: 'ok' }],
        findings: [],
        reminders: Array.from({ length: 8 }, (_, index) => `recordatorio-${index}`),
        nextCommand: 'sentinel check T-3',
      },
    } as unknown as GateReportResult;
    const context = { projectRoot: 'C:/repo', qualityConfig: { maxFindings: 3, maxReminders: 4 } };
    const lines = compactLines(reportResult, context);
    const reminders = lines.filter(line => line.includes('REMEMBER'));
    assert.strictEqual(reminders.length, 4);
    assert.match(reminders[0], /recordatorio-0/);
    assert.doesNotMatch(reminders.at(-1) ?? '', /recordatorio-7/);
  });

  test('el reporte JSON, Markdown y compacto no exponen secretos de findings ni reminders', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-report-secret-'));
    try {
      fs.mkdirSync(path.join(projectRoot, '.quality-reports', 'T-4'), { recursive: true });
      const secretFinding = {
        severity: 'error' as const,
        ruleId: 'hardcoded-secret',
        message: 'token=sk_test_abcdefghijklmnopqrstuvwxyz encontrado',
      };
      const result = await createReport(
        {
          projectRoot,
          reportRoot: path.join(projectRoot, '.quality-reports', 'T-4'),
          qualityConfig: { maxFindings: 3, maxReminders: 4 },
          tools: {},
          policyIdentity: {
            projectRoot,
            policyPath: null,
            policyHash: 'p',
            runtimeVersion: null,
            decision: { status: 'no-policy', mode: 'observe', action: 'pass-through', blocked: false, reason: 'sin política' },
            reason: 'sin política',
            recommendedCommand: 'sentinel check T-4',
          },
        },
        { taskId: 'T-4', ci: false },
        { base: 'HEAD', full: false, files: [], profiles: [] },
        [{ stage: 'sentinel', status: 'fail', durationMs: 1, findings: [secretFinding], summary: '1 error' }],
        ['Bearer secret_bearer_token_123456789012'],
        Date.now(),
      );
      const json = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8'));
      const markdown = fs.readFileSync(result.markdownPath, 'utf8');
      const compact = compactLines(result, { projectRoot, qualityConfig: { maxFindings: 3, maxReminders: 4 } });
      const secrets = ['sk_test_abcdefghijklmnopqrstuvwxyz', 'secret_bearer_token_123456789012'];
      for (const secret of secrets) {
        assert.doesNotMatch(JSON.stringify(json), new RegExp(secret));
        assert.doesNotMatch(markdown, new RegExp(secret));
        assert.doesNotMatch(compact.join('\n'), new RegExp(secret));
      }
      assert.match(JSON.stringify(json), /REDACTED/);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('el artifact conserva todos los hallazgos y los ordena de forma determinista', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-report-order-'));
    try {
      const reportRoot = path.join(projectRoot, '.quality-reports', 'T-ORDER');
      fs.mkdirSync(reportRoot, { recursive: true });
      const result = await createReport(
        { projectRoot, reportRoot, qualityConfig: { maxFindings: 2, maxReminders: 1 }, tools: {} },
        { taskId: 'T-ORDER', ci: false },
        { base: 'HEAD', full: false, files: ['a.ts'], profiles: [] },
        [{
          stage: 'sentinel', status: 'fail', durationMs: 1,
          findings: [
            { severity: 'warning', ruleId: 'z-rule', file: 'z.ts', line: 2, message: 'z' },
            { severity: 'error', ruleId: 'b-rule', file: 'b.ts', line: 4, message: 'b' },
            { severity: 'error', ruleId: 'a-rule', file: 'a.ts', line: 9, message: 'a' },
          ], summary: '2 errores, 1 warning',
        }],
        ['uno', 'dos'],
        Date.now(),
      );
      const persisted = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8'));
      assert.deepEqual(persisted.findings.map((finding: { ruleId?: string }) => finding.ruleId), ['a-rule', 'b-rule', 'z-rule']);
      assert.strictEqual(persisted.findings.length, 3, 'el artifact no debe aplicar el límite de la salida compacta');
      const compact = compactLines(result, { projectRoot, qualityConfig: { maxFindings: 2, maxReminders: 1 } });
      assert.strictEqual(compact.filter(line => line.includes('ERROR') || line.includes('WARNING')).length, 2);
      assert.strictEqual(compact.filter(line => line.includes('REMEMBER')).length, 1);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('createReport representa cancelación con exit code 130', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-report-cancelled-'));
    try {
      fs.mkdirSync(path.join(projectRoot, '.quality-reports', 'T-CANCEL'), { recursive: true });
      const result = await createReport(
        {
          projectRoot,
          reportRoot: path.join(projectRoot, '.quality-reports', 'T-CANCEL'),
          qualityConfig: { maxFindings: 3 },
          tools: {},
        },
        { taskId: 'T-CANCEL', ci: false },
        { base: 'HEAD', full: false, files: [], profiles: [] },
        [{ stage: 'sentinel', status: 'error', state: 'cancelled', durationMs: 1, findings: [], summary: 'cancelled' }],
        [],
        Date.now(),
      );
      assert.strictEqual(result.report.decision.label, 'CANCELLED');
      assert.strictEqual(result.report.decision.exitCode, 130);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('createReport serializa la identidad de política en JSON y Markdown', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-report-policy-'));
    try {
      fs.mkdirSync(path.join(projectRoot, '.quality-reports', 'T-2'), { recursive: true });
      const result = await createReport(
        {
          projectRoot,
          reportRoot: path.join(projectRoot, '.quality-reports', 'T-2'),
          qualityConfig: { maxFindings: 3 },
          tools: {},
          policyIdentity: {
            projectRoot,
            policyPath: path.join(projectRoot, 'sentinel.config.json'),
            policyHash: 'policy-hash-test',
            runtimeVersion: '0.4.0',
            decision: { status: 'policy', mode: 'enforce', action: 'enforce', blocked: false, reason: 'política v2 válida' },
            reason: 'política v2 válida',
            recommendedCommand: 'sentinel check T-2',
          },
        },
        { taskId: 'T-2', ci: false },
        { base: 'HEAD', full: true, executionFull: false, files: [], profiles: ['docs'] },
        [{ stage: 'sentinel', status: 'pass', durationMs: 1, findings: [], summary: '0 errores' }],
        [],
        Date.now(),
      );
      const json = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8'));
      const markdown = fs.readFileSync(result.markdownPath, 'utf8');
      assert.strictEqual(json.policy.policyHash, 'policy-hash-test');
      assert.strictEqual(json.mode, 'local-light');
      assert.strictEqual(json.scope.full, true);
      assert.strictEqual(json.scope.executionFull, false);
      assert.match(markdown, /policy-hash-test/);
      assert.match(markdown, /política v2 válida/);
      assert.strictEqual(json.scope.effectiveFull, false);
      assert.strictEqual(json.scope.fullReason, null);
      assert.match(markdown, /Alcance/);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('createReport refleja un full diferido con effectiveFull=false y motivo', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-report-deferred-'));
    try {
      fs.mkdirSync(path.join(projectRoot, '.quality-reports', 'T-DEFER'), { recursive: true });
      const result = await createReport(
        {
          projectRoot,
          reportRoot: path.join(projectRoot, '.quality-reports', 'T-DEFER'),
          qualityConfig: { maxFindings: 3 },
          tools: {},
        },
        { taskId: 'T-DEFER', ci: false },
        {
          base: 'HEAD',
          full: true,
          requestedFull: true,
          automaticFull: true,
          effectiveFull: false,
          fullReason: 'heavy-deferred',
          heavyDeferred: true,
          files: ['scripts/quality/scope.mjs'],
          profiles: [],
        },
        [{ stage: 'sentinel', status: 'pass', durationMs: 1, findings: [], summary: '0 errores' }],
        [],
        Date.now(),
      );
      const json = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8'));
      assert.strictEqual(json.scope.full, true);
      assert.strictEqual(json.scope.effectiveFull, false);
      assert.strictEqual(json.scope.fullReason, 'heavy-deferred');
      assert.strictEqual(json.scope.heavyDeferred, true);
      const compact = compactLines(result, { projectRoot, qualityConfig: { maxFindings: 3 } });
      assert.match(compact.join('\n'), /heavy-deferred/);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
