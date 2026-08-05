/* [028A-6 Fase 4] Matriz de decisiones del guard (unit): por cada fixture de
 * la matriz multi-proyecto y cada comando, la decisión esperada
 * (bloqueado/pasa con exit code 78 o 0). Fixtures copiados a tmp para que el
 * walk-up de findQualityRoot no herede la política del repo de Sentinel.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { inspectDirectCommand, QUALITY_GUARD_EXIT_CODE } from '../../core/guardCommand';
import { copyFixtureToTmp } from './guardMatrixCommon';

interface MatrixCase {
  fixture: string;
  executable: string;
  args: string[];
  blocked: boolean;
  policyStatus: string | null;
  reason?: RegExp | string;
}

const CASES: MatrixCase[] = [
  /* Node (enforce): scripts y tools configurados en la política. */
  { fixture: 'node-project', executable: 'npm', args: ['run', 'test'], blocked: true, policyStatus: 'policy', reason: /npm test/ },
  { fixture: 'node-project', executable: 'npm', args: ['run', 'test:watch'], blocked: true, policyStatus: 'policy', reason: /npm test:watch/ },
  { fixture: 'node-project', executable: 'npm', args: ['run', 'build'], blocked: true, policyStatus: 'policy' },
  { fixture: 'node-project', executable: 'npm', args: ['run', 'dev'], blocked: false, policyStatus: 'policy' },
  { fixture: 'node-project', executable: 'npm', args: ['install'], blocked: false, policyStatus: 'policy' },
  { fixture: 'node-project', executable: 'npm', args: ['--version'], blocked: false, policyStatus: 'policy' },
  { fixture: 'node-project', executable: 'npm', args: ['run', 'test', '--', '--watch'], blocked: true, policyStatus: 'policy' },
  { fixture: 'node-project', executable: 'npx', args: ['vitest', 'run'], blocked: true, policyStatus: 'policy', reason: /npx vitest/ },
  { fixture: 'node-project', executable: 'npx', args: ['eslint', 'src'], blocked: true, policyStatus: 'policy' },
  { fixture: 'node-project', executable: 'npx', args: ['some-other-tool'], blocked: false, policyStatus: 'policy' },
  { fixture: 'node-project', executable: 'vitest', args: ['run'], blocked: true, policyStatus: 'policy' },
  { fixture: 'node-project', executable: 'tsc', args: ['--noEmit'], blocked: true, policyStatus: 'policy' },
  { fixture: 'node-project', executable: 'node', args: ['scripts/build.mjs'], blocked: false, policyStatus: 'policy' },
  { fixture: 'node-project', executable: 'cargo', args: ['test'], blocked: false, policyStatus: 'policy' },
  /* Rust (enforce): cargoSubcommands y tools. */
  { fixture: 'rust-project', executable: 'cargo', args: ['test'], blocked: true, policyStatus: 'policy', reason: /cargo test/ },
  { fixture: 'rust-project', executable: 'cargo', args: ['check'], blocked: true, policyStatus: 'policy' },
  { fixture: 'rust-project', executable: 'cargo', args: ['clippy', '--all-targets'], blocked: true, policyStatus: 'policy' },
  { fixture: 'rust-project', executable: 'cargo', args: ['test', '--release'], blocked: true, policyStatus: 'policy' },
  { fixture: 'rust-project', executable: 'cargo', args: ['build'], blocked: false, policyStatus: 'policy' },
  { fixture: 'rust-project', executable: 'cargo', args: ['run'], blocked: false, policyStatus: 'policy' },
  { fixture: 'rust-project', executable: 'rustfmt', args: ['src/lib.rs'], blocked: true, policyStatus: 'policy' },
  { fixture: 'rust-project', executable: 'npm', args: ['run', 'test'], blocked: false, policyStatus: 'policy' },
  /* Python (enforce, sin tools): nada interceptado. */
  { fixture: 'python-project', executable: 'python', args: ['main.py'], blocked: false, policyStatus: 'policy' },
  { fixture: 'python-project', executable: 'pip', args: ['install', 'requests'], blocked: false, policyStatus: 'policy' },
  { fixture: 'python-project', executable: 'npm', args: ['run', 'test'], blocked: false, policyStatus: 'policy' },
  { fixture: 'python-project', executable: 'cargo', args: ['test'], blocked: false, policyStatus: 'policy' },
  /* Sin marcador: todo pasa y no hay raíz (policyStatus null = sin raíz). */
  { fixture: 'no-policy-project', executable: 'npm', args: ['run', 'test'], blocked: false, policyStatus: null },
  { fixture: 'no-policy-project', executable: 'cargo', args: ['test'], blocked: false, policyStatus: null },
  { fixture: 'no-policy-project', executable: 'npx', args: ['vitest'], blocked: false, policyStatus: null },
  /* Legacy v1 (quality.config.json): defaults del orquestador anterior. */
  { fixture: 'legacy-v1-project', executable: 'npm', args: ['run', 'test'], blocked: true, policyStatus: 'legacy-v1', reason: /npm test/ },
  { fixture: 'legacy-v1-project', executable: 'npx', args: ['vitest'], blocked: true, policyStatus: 'legacy-v1' },
  { fixture: 'legacy-v1-project', executable: 'cargo', args: ['test'], blocked: true, policyStatus: 'legacy-v1' },
  { fixture: 'legacy-v1-project', executable: 'npm', args: ['install'], blocked: false, policyStatus: 'legacy-v1' },
];

suite('Sentinel guard matrix multi-proyecto (Fase 4)', () => {
  const copies = new Map<string, string>();

  function copyFor(fixture: string): string {
    let root = copies.get(fixture);
    if (!root) {
      root = copyFixtureToTmp(fixture);
      copies.set(fixture, root);
    }
    return root;
  }

  suiteTeardown(() => {
    for (const root of copies.values()) fs.rmSync(path.dirname(root), { recursive: true, force: true });
  });

  for (const entry of CASES) {
    test(`${entry.fixture}: ${entry.executable} ${entry.args.join(' ')} → ${entry.blocked ? 'bloqueado' : 'pasa'}`, async () => {
      const decision = await inspectDirectCommand({
        executable: entry.executable,
        args: entry.args,
        projectRoot: copyFor(entry.fixture),
      });
      assert.strictEqual(decision.blocked, entry.blocked, `decisión inesperada: ${JSON.stringify(decision)}`);
      assert.strictEqual(decision.policyStatus ?? null, entry.policyStatus);
      if (entry.blocked) {
        assert.strictEqual(decision.exitCode, QUALITY_GUARD_EXIT_CODE);
        if (entry.reason) {
          const expected = entry.reason instanceof RegExp ? entry.reason : new RegExp(String(entry.reason));
          assert.match(String(decision.command ?? ''), expected);
        }
      } else {
        assert.strictEqual(decision.exitCode, undefined);
      }
    });
  }
});
