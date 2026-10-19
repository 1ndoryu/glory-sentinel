/* [10AA-2 F11.2] Avisos no bloqueantes de `sentinel doctor`: comandos de la
 * política que alguna shell no intercepta y runtime instalado desfasado. No
 * cambian `ready` ni el preflight. */
import * as assert from 'assert';
import { avisosDeCobertura, avisosDeRuntime } from '../../../core/diagnostico/diagnoseAvisos';
import type { GuardPolicy } from '../../../core/guard/guardCommand';
import type { RuntimeStatusResult } from '../../../core/runtime-proyecto/runtimeInstall';

function politica(overrides: Partial<GuardPolicy> = {}): GuardPolicy {
  return { status: 'policy', ...overrides };
}

function runtime(overrides: Partial<RuntimeStatusResult> = {}): RuntimeStatusResult {
  return {
    targetRoot: 'C:/runtime',
    versions: [],
    activeVersion: null,
    activeHash: null,
    activeVerified: false,
    sourceVersion: null,
    ...overrides,
  };
}

suite('Sentinel core diagnose: avisos de cobertura y runtime (10AA-2 F11.2)', () => {
  test('cmd no envuelve tsc, vitest, eslint, prettier ni rustfmt: lo declara', () => {
    const avisos = avisosDeCobertura(politica({
      npmScripts: new Set(['test']),
      npxTools: new Set(['vitest']),
      cargoSubcommands: new Set(['test']),
      tools: new Set(['tsc', 'eslint', 'prettier', 'rustfmt']),
    }));
    assert.strictEqual(avisos.length, 1);
    assert.strictEqual(avisos[0].code, 'guard-sin-shim');
    assert.strictEqual(
      avisos[0].message,
      'cmd: sin shim para eslint, prettier, rustfmt, tsc, vitest; esa shell no aplica la política a esos comandos',
    );
  });

  test('npm y cargo tienen shim en las tres shells: sin avisos', () => {
    assert.deepStrictEqual(avisosDeCobertura(politica({
      npmScripts: new Set(['test']),
      cargoSubcommands: new Set(['test']),
    })), []);
  });

  test('sin política v2 no hay avisos de cobertura', () => {
    assert.deepStrictEqual(avisosDeCobertura({ status: 'no-policy' }), []);
    assert.deepStrictEqual(avisosDeCobertura({ status: 'legacy-v1' }), []);
  });

  test('runtime activo distinto de la fuente declara el desfase', () => {
    const avisos = avisosDeRuntime(runtime({ activeVersion: '0.7.23', sourceVersion: '0.7.20' }));
    assert.strictEqual(avisos.length, 1);
    assert.strictEqual(avisos[0].code, 'runtime-desfasado');
    assert.match(avisos[0].message, /sentinel update --with-shims/);
  });

  test('runtime igual, sin instalar o sin fuente no avisa', () => {
    assert.deepStrictEqual(avisosDeRuntime(runtime({ activeVersion: '0.7.20', sourceVersion: '0.7.20' })), []);
    assert.deepStrictEqual(avisosDeRuntime(runtime({ activeVersion: null, sourceVersion: '0.7.20' })), []);
    assert.deepStrictEqual(avisosDeRuntime(runtime({ activeVersion: '0.7.20', sourceVersion: null })), []);
  });
});
