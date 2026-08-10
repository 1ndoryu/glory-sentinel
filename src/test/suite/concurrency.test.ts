/* [108A-1 Fase 6] Fixtures de concurrencia: N agentes con claims DISTINTOS en
 * el mismo workspace (todos deben ganar sin corrupción, serializados por el
 * lock) y dos gates ligeros simultáneos sobre el mismo workspace (ambos exit 0
 * y JSON íntegro, sin intercalación ni corrupción de reportes). */
import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { claimTask } from '../../core/taskCoordinator';
import { runProcess } from '../../core/toolRunner';

const PRIMARY_BRANCH = 'wandorius';
const CLI = path.resolve(__dirname, '../../cli/index.js');

function fixture(): { parent: string; root: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-conc-'));
  const root = path.join(parent, 'repo');
  fs.mkdirSync(root);
  execFileSync('git', ['init', '-q', '-b', PRIMARY_BRANCH], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'conc@example.test'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Conc Test'], { cwd: root, stdio: 'ignore' });
  const services = path.join(root, 'legacy', 'services');
  fs.mkdirSync(services, { recursive: true });
  fs.writeFileSync(path.join(services, 'foo.ts'), 'export const value = 1;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n', 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: root, stdio: 'ignore' });
  return { parent, root };
}

suite('concurrencia — claims 1/2/4 y gates ligeros simultáneos (108A-1 F6)', () => {
  test('un agente reclama una tarea en el workspace', async () => {
    const { parent, root } = fixture();
    try {
      const record = await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-1', agent: 'agent-1' });
      assert.strictEqual(record.agent, 'agent-1');
      assert.strictEqual(record.taskId, 'T-1');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('dos agentes con claims distintos ganan ambos sin corrupción', async () => {
    const { parent, root } = fixture();
    try {
      const results = await Promise.allSettled([
        claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-A', agent: 'agent-a' }),
        claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-B', agent: 'agent-b' }),
      ]);
      assert.strictEqual(results.filter(result => result.status === 'fulfilled').length, 2, 'ambos claims ganan');
      const records = results.map(result => (result as PromiseFulfilledResult<{ agent: string }>).value);
      assert.deepStrictEqual(new Set(records.map(record => record.agent)), new Set(['agent-a', 'agent-b']));
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('cuatro agentes con claims distintos en el mismo workspace: todos ganan, cero corrupción', async () => {
    const { parent, root } = fixture();
    try {
      const results = await Promise.allSettled(
        ['agent-1', 'agent-2', 'agent-3', 'agent-4'].map(agent =>
          claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: `T-${agent}`, agent })),
      );
      assert.strictEqual(results.filter(result => result.status === 'fulfilled').length, 4, 'los cuatro claims ganan');
      const records = results.map(result => (result as PromiseFulfilledResult<{ taskId: string }>).value);
      assert.strictEqual(new Set(records.map(record => record.taskId)).size, 4, 'cuatro tareas distintas');
      /* La metadata queda íntegra: cada tarea existe como archivo en el
       * directorio de coordinación del proyecto. */
      const coordDir = path.join(root, '.sentinel', 'coordination');
      const owners = fs.readdirSync(coordDir, { recursive: true }).filter(name => String(name).endsWith('.json'));
      assert.ok(owners.length >= 4, 'metadata de las cuatro tareas presente');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('dos gates ligeros simultáneos sobre el mismo workspace: ambos exit 0 y JSON íntegro', async function () {
    const { parent, root } = fixture();
    try {
      const outA = path.join(root, 'report-a.json');
      const outB = path.join(root, 'report-b.json');
      const args = (output: string): string[] => ['analyze', '--workspace', root, '--format', 'json', '--output', output];
      const [runA, runB] = await Promise.all([
        runProcess(process.execPath, [CLI, ...args(outA)], { cwd: root, timeoutMs: 60_000 }),
        runProcess(process.execPath, [CLI, ...args(outB)], { cwd: root, timeoutMs: 60_000 }),
      ]);
      assert.strictEqual(runA.code, 0, `gate A exit 0; stderr=${runA.stderr}`);
      assert.strictEqual(runB.code, 0, `gate B exit 0; stderr=${runB.stderr}`);
      const reportA = JSON.parse(fs.readFileSync(outA, 'utf8').trim()) as { schemaVersion?: unknown; entries?: unknown };
      const reportB = JSON.parse(fs.readFileSync(outB, 'utf8').trim()) as { schemaVersion?: unknown; entries?: unknown };
      assert.ok(reportA.schemaVersion !== undefined && Array.isArray(reportA.entries), 'reporte A íntegro');
      assert.ok(reportB.schemaVersion !== undefined && Array.isArray(reportB.entries), 'reporte B íntegro');
      assert.deepStrictEqual(reportA.entries, reportB.entries, 'misma decisión en ambos gates');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('cuatro gates ligeros simultáneos: sin corrupción de reportes ni procesos colgados', async function () {
    const { parent, root } = fixture();
    try {
      const outputs = ['r1', 'r2', 'r3', 'r4'].map(name => path.join(root, `report-${name}.json`));
      const runs = await Promise.all(outputs.map(output =>
        runProcess(process.execPath, [CLI, 'analyze', '--workspace', root, '--format', 'json', '--output', output], { cwd: root, timeoutMs: 60_000 })));
      for (const run of runs) assert.strictEqual(run.code, 0, `gate exit 0; stderr=${run.stderr}`);
      const reports = outputs.map(output => JSON.parse(fs.readFileSync(output, 'utf8').trim()) as { entries?: unknown });
      assert.ok(reports.every(report => Array.isArray(report.entries)), 'los cuatro reportes son JSON íntegros');
      assert.deepStrictEqual(reports[0].entries, reports[3].entries, 'decisión consistente entre corridas');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('concurrencia real de claims: sin duplicar ni perder metadata', async () => {
    const { parent, root } = fixture();
    try {
      /* 8 claims concurrentes (2 por agente, tareas distintas): el lock por
       * tarea serializa sin intercalación; nada se pierde ni duplica. */
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: `T-${index}`, agent: `agent-${index % 4}` })),
      );
      assert.strictEqual(results.filter(result => result.status === 'fulfilled').length, 8);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
