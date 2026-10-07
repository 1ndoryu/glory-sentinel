/* [07AA-6 F2] Tests del tope físico de validaciones pesadas: clasificación
 * (directa + wrapper cargo-stage.ps1), política budgets con fail open y
 * contador por tarea en runs.jsonl (cupo, observe, override lote-extra.md). */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkAndRecordHeavyRun, classifyHeavy, defaultBudgets, readBudgets } from '../../core/heavyBudget';

function makeRoots(config?: unknown, extra?: string): { projectRoot: string; reportRoot: string; cleanup: () => void } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-budget-proj-'));
  const reportRoot = path.join(projectRoot, '.quality-reports', 'check', 'TEST-1');
  if (config !== undefined) {
    fs.writeFileSync(path.join(projectRoot, 'sentinel.config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  if (extra !== undefined) fs.writeFileSync(path.join(projectRoot, 'lote-extra.md'), extra);
  return { projectRoot, reportRoot, cleanup: () => fs.rmSync(projectRoot, { recursive: true, force: true }) };
}

function runs(reportRoot: string): Array<{ kind?: unknown; status?: unknown }> {
  const raw = fs.readFileSync(path.join(reportRoot, 'runs.jsonl'), 'utf8');
  return raw.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

suite('Sentinel core heavy budget (tope físico 07AA-6)', () => {
  test('clasifica invocación directa de cargo pesado y excluye fmt/bench', () => {
    assert.strictEqual(classifyHeavy('cargo', ['check', '--all-targets']), 'cargo-check');
    assert.strictEqual(classifyHeavy('cargo.exe', ['clippy', '--', '-D', 'warnings']), 'cargo-clippy');
    assert.strictEqual(classifyHeavy('cargo', ['test', '--lib']), 'cargo-test');
    assert.strictEqual(classifyHeavy('cargo', ['fmt', '--all']), null);
    assert.strictEqual(classifyHeavy('cargo', ['bench']), null);
  });

  test('clasifica el wrapper cargo-stage.ps1 y excluye fmt/fmt-write', () => {
    const wrap = (stage: string): string[] => ['cargo-stage.ps1', 'R:\\rep.json', stage, '--', '--check'];
    assert.strictEqual(classifyHeavy('pwsh', wrap('clippy')), 'cargo-clippy');
    assert.strictEqual(classifyHeavy('pwsh', wrap('check')), 'cargo-check');
    assert.strictEqual(classifyHeavy('pwsh', wrap('test')), 'cargo-test');
    assert.strictEqual(classifyHeavy('pwsh', wrap('fmt')), null);
    assert.strictEqual(classifyHeavy('pwsh', wrap('fmt-write')), null);
  });

  test('clasifica tsc --noEmit y excluye node/vitest/tsc sin flag', () => {
    assert.strictEqual(classifyHeavy('tsc', ['--noEmit', '-p', '.']), 'tsc-noemit');
    assert.strictEqual(classifyHeavy('tsc', ['-p', '.']), null);
    assert.strictEqual(classifyHeavy(process.execPath, ['-e', '1']), null);
    assert.strictEqual(classifyHeavy('vitest', ['run']), null);
  });

  test('sin política o inválida: fail open en observe con default 5', async () => {
    const { projectRoot, cleanup } = makeRoots();
    try {
      assert.deepStrictEqual(await readBudgets(projectRoot), defaultBudgets());
      const bad = makeRoots('no-json{');
      try {
        assert.deepStrictEqual(await readBudgets(bad.projectRoot), defaultBudgets());
      } finally {
        bad.cleanup();
      }
    } finally {
      cleanup();
    }
  });

  test('lee budgets custom y descarta valores no enteros', async () => {
    const { projectRoot, cleanup } = makeRoots({
      schemaVersion: 2,
      mode: 'enforce',
      guard: { directCommands: { npmScripts: [], npxTools: [], cargoSubcommands: [], tools: [] } },
      budgets: { mode: 'enforce', limits: { 'cargo-check': 2, 'cargo-test': 'muchos', 'x': -1 } },
    });
    try {
      const budgets = await readBudgets(projectRoot);
      assert.strictEqual(budgets.mode, 'enforce');
      assert.strictEqual(budgets.limits['cargo-check'], 2);
      assert.strictEqual(budgets.limits['cargo-test'], 5);
      assert.strictEqual(budgets.limits['tsc-noemit'], 5);
    } finally {
      cleanup();
    }
  });

  test('enforce: 5 permitidos y el 6º bloqueado sin ejecutar', async () => {
    const { projectRoot, reportRoot, cleanup } = makeRoots({
      schemaVersion: 2,
      mode: 'enforce',
      guard: { directCommands: { npmScripts: [], npxTools: [], cargoSubcommands: [], tools: [] } },
      budgets: { mode: 'enforce' },
    });
    try {
      for (let used = 0; used < 5; used++) {
        const check = await checkAndRecordHeavyRun({ projectRoot, reportRoot, kind: 'cargo-check', stage: 'check' });
        assert.strictEqual(check.allowed, true);
        assert.strictEqual(check.used, used);
        assert.strictEqual(check.limit, 5);
      }
      const blocked = await checkAndRecordHeavyRun({ projectRoot, reportRoot, kind: 'cargo-check', stage: 'check' });
      assert.strictEqual(blocked.allowed, false);
      assert.strictEqual(blocked.used, 5);
      const lines = runs(reportRoot);
      assert.strictEqual(lines.length, 6);
      assert.strictEqual(lines[5].status, 'blocked');
      /* Otra clase no consume del mismo cupo. */
      const other = await checkAndRecordHeavyRun({ projectRoot, reportRoot, kind: 'cargo-clippy', stage: 'clippy' });
      assert.strictEqual(other.allowed, true);
      assert.strictEqual(other.used, 0);
    } finally {
      cleanup();
    }
  });

  test('observe: supera el tope permitiendo y avisando', async () => {
    const { projectRoot, reportRoot, cleanup } = makeRoots({ budgets: { limits: { 'cargo-test': 1 } } });
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown): void => { warnings.push(String(message)); };
    try {
      assert.strictEqual((await checkAndRecordHeavyRun({ projectRoot, reportRoot, kind: 'cargo-test', stage: 'test' })).allowed, true);
      const over = await checkAndRecordHeavyRun({ projectRoot, reportRoot, kind: 'cargo-test', stage: 'test' });
      assert.strictEqual(over.allowed, true);
      assert.strictEqual(over.observed, true);
      assert.ok(warnings.some(message => message.includes('cargo-test')));
    } finally {
      console.warn = original;
      cleanup();
    }
  });

  test('lote-extra.md +3 amplía el cupo de forma auditable', async () => {
    const { projectRoot, reportRoot, cleanup } = makeRoots({
      schemaVersion: 2,
      mode: 'enforce',
      guard: { directCommands: { npmScripts: [], npxTools: [], cargoSubcommands: [], tools: [] } },
      budgets: { mode: 'enforce', limits: { 'cargo-check': 1 } },
    }, '# lote extra\n\n+3\n');
    try {
      for (let i = 0; i < 4; i++) {
        const check = await checkAndRecordHeavyRun({ projectRoot, reportRoot, kind: 'cargo-check', stage: 'check' });
        assert.strictEqual(check.allowed, true);
        assert.strictEqual(check.extra, 3);
      }
      const blocked = await checkAndRecordHeavyRun({ projectRoot, reportRoot, kind: 'cargo-check', stage: 'check' });
      assert.strictEqual(blocked.allowed, false);
      assert.strictEqual(blocked.used, 4);
    } finally {
      cleanup();
    }
  });

  test('línea corrupta en runs.jsonl se ignora sin romper el gate', async () => {
    const { projectRoot, reportRoot, cleanup } = makeRoots({ budgets: { mode: 'enforce' } });
    try {
      fs.mkdirSync(reportRoot, { recursive: true });
      fs.writeFileSync(path.join(reportRoot, 'runs.jsonl'), 'rota{\n{"kind":"cargo-check","status":"started"}\n');
      const check = await checkAndRecordHeavyRun({ projectRoot, reportRoot, kind: 'cargo-check', stage: 'check' });
      assert.strictEqual(check.allowed, true);
      assert.strictEqual(check.used, 1);
    } finally {
      cleanup();
    }
  });
});
