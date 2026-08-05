/* [028A-6 Fase 1] Tests del clasificador de política (extraído de
 * scripts/quality/tests/policy-decision.test.mjs): modos de política v2,
 * fallback legacy y no-policy. */
import * as assert from 'assert';
import { decisionForGuard, policyDecision } from '../../core/policyDecision';

suite('Sentinel core policy decision (orquestador agnóstico)', () => {
  test('expone pass-through para no-policy sin bloquear', () => {
    const decision = policyDecision({ status: 'no-policy' });
    assert.deepStrictEqual(decision, {
      status: 'no-policy',
      mode: 'pass-through',
      action: 'pass-through',
      blocked: false,
      reason: 'no-policy',
    });
    assert.strictEqual(decisionForGuard({ status: 'no-policy' }, 'npx vitest').blocked, false);
  });

  test('mantiene fallback legacy y lo puede marcar como bloqueo de comando directo', () => {
    const decision = policyDecision({ status: 'legacy-v1', warning: 'legacy' });
    assert.strictEqual(decision.action, 'legacy-fallback');
    assert.strictEqual(decisionForGuard({ status: 'legacy-v1' }, 'npm test').blocked, true);
  });

  test('distingue observe, enforce y pass-through de política v2', () => {
    for (const [mode, action, blocked, observed] of [
      ['observe', 'observe', false, true],
      ['enforce', 'enforce', true, false],
      ['pass-through', 'pass-through', false, false],
    ] as const) {
      const discovered = { status: 'policy', policy: { mode } };
      const decision = decisionForGuard(discovered, 'cargo test');
      assert.strictEqual(decision.action, action);
      assert.strictEqual(decision.blocked, blocked);
      assert.strictEqual(decision.observed, observed ? 'cargo test' : false);
    }
  });

  test('invalid-policy es observable como error pero nunca bloquea comandos desconocidos', () => {
    const decision = policyDecision({ status: 'invalid-policy', error: 'JSON inválido' });
    assert.strictEqual(decision.action, 'error');
    assert.strictEqual(decision.blocked, false);
    assert.strictEqual(decisionForGuard({ status: 'invalid-policy' }, 'comando desconocido').blocked, false);
  });
});
