/* [10AA-2 F11.2] Registro NDJSON de decisiones del guard: campos, motivo,
 * rotación a 1 MiB y best-effort (nunca lanza ni cambia la decisión). */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { GuardDecision } from '../../../core/guard/guardCommand';
import { clasificarDecision, GUARD_LOG_MAX_BYTES, registrarDecision, resumenComando } from '../../../core/guard/guardLog';
import { tmpBaseDir } from '../../../core/seguridad-rutas/tmpDir';
import { removeTmpRoots } from './guardMatrixCommon';

const cleanup: string[] = [];

/* Temporales en tmpBaseDir (C:\tmp en Windows, AGENTS §0.2), no en %TEMP%. */
function mkTmp(prefix: string): string {
  const base = tmpBaseDir();
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, prefix));
  cleanup.push(dir);
  return dir;
}

function decision(overrides: Partial<GuardDecision>): GuardDecision {
  return { blocked: false, root: 'C:/proyecto', ...overrides };
}

function leerLineas(file: string): Array<Record<string, unknown>> {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
}

suite('Sentinel core guardLog (registro de decisiones)', () => {
  suiteTeardown(() => removeTmpRoots(cleanup));

  test('registra una línea NDJSON con decisión, proyecto y motivo, sin argumentos sensibles', async () => {
    const dir = mkTmp('guard-log-campos-');
    await registrarDecision(
      decision({ blocked: true, reason: 'npm run test no está permitido', policyStatus: 'policy' }),
      'npm', ['run', 'test', '--token', 'secreto-123'], { GLORY_GUARD_LOG_DIR: dir },
    );
    const [linea] = leerLineas(path.join(dir, 'guard-log.ndjson'));
    assert.strictEqual(linea.decision, 'bloqueado');
    assert.strictEqual(linea.proyecto, 'C:/proyecto');
    assert.strictEqual(linea.comando, 'npm run');
    assert.strictEqual(linea.motivo, 'npm run test no está permitido');
    assert.ok(typeof linea.fecha === 'string' && !Number.isNaN(Date.parse(linea.fecha)));
    assert.doesNotMatch(JSON.stringify(linea), /secreto-123/);
  });

  test('observe registra "observado"; sin motivo cae a policyStatus; cargo sin reglas es "paso"', async () => {
    const dir = mkTmp('guard-log-modos-');
    const env = { GLORY_GUARD_LOG_DIR: dir };
    /* En modo observe decisionForGuard deja observed = motivo y blocked = false. */
    await registrarDecision(decision({ blocked: false, observed: 'npm run test', reason: 'npm run test' }), 'npm', ['run', 'test'], env);
    await registrarDecision(decision({ policyStatus: 'no-policy' }), 'cargo', ['+nightly', 'check'], env);
    const [observado, paso] = leerLineas(path.join(dir, 'guard-log.ndjson'));
    assert.strictEqual(observado.decision, 'observado');
    assert.strictEqual(observado.motivo, 'npm run test');
    assert.strictEqual(paso.decision, 'paso');
    assert.strictEqual(paso.motivo, 'no-policy');
    assert.strictEqual(paso.comando, 'cargo check');
  });

  test('el paso con legacy-token queda registrado con su motivo y sin proyecto', async () => {
    const dir = mkTmp('guard-log-token-');
    await registrarDecision(decision({ root: null, reason: 'legacy-token' }), 'npm', ['run', 'test'], { GLORY_GUARD_LOG_DIR: dir });
    const [linea] = leerLineas(path.join(dir, 'guard-log.ndjson'));
    assert.strictEqual(linea.decision, 'paso');
    assert.strictEqual(linea.motivo, 'legacy-token');
    assert.strictEqual(linea.proyecto, null);
  });

  test('al superar 1 MiB rota a guard-log.1.ndjson y empieza un fichero nuevo', async () => {
    const dir = mkTmp('guard-log-rotacion-');
    const file = path.join(dir, 'guard-log.ndjson');
    fs.writeFileSync(file, Buffer.alloc(GUARD_LOG_MAX_BYTES, 'x'));
    await registrarDecision(decision({ blocked: true, reason: 'bloqueo' }), 'npm', ['run', 'test'], { GLORY_GUARD_LOG_DIR: dir });
    assert.strictEqual(fs.statSync(path.join(dir, 'guard-log.1.ndjson')).size, GUARD_LOG_MAX_BYTES);
    const nuevo = leerLineas(file);
    assert.strictEqual(nuevo.length, 1);
    assert.strictEqual(nuevo[0].decision, 'bloqueado');
  });

  test('best-effort: si la ruta de registro es un fichero no lanza', async () => {
    const dir = mkTmp('guard-log-roto-');
    const ruta = path.join(dir, 'no-es-directorio');
    fs.writeFileSync(ruta, 'x');
    await assert.doesNotReject(
      registrarDecision(decision({ blocked: true, reason: 'x' }), 'npm', ['run', 'test'], { GLORY_GUARD_LOG_DIR: ruta }),
    );
  });

  test('el comando registrado se acota a 120 caracteres', async () => {
    const dir = mkTmp('guard-log-largo-');
    await registrarDecision(decision({ blocked: true, reason: 'x' }), 'npm', ['a'.repeat(300)], { GLORY_GUARD_LOG_DIR: dir });
    const [linea] = leerLineas(path.join(dir, 'guard-log.ndjson'));
    assert.ok(String(linea.comando).length <= 120);
  });

  test('resumenComando deja ejecutable y subcomando, saltando toolchain y opciones globales', () => {
    assert.strictEqual(resumenComando('cargo', ['+nightly', 'check', '--token', 'x']), 'cargo check');
    assert.strictEqual(resumenComando('cargo.exe', ['--color', 'never', 'Test']), 'cargo.exe test');
    assert.strictEqual(resumenComando('npm.cmd', ['run', 'test']), 'npm.cmd run');
    assert.strictEqual(resumenComando('tsc'), 'tsc');
  });

  test('clasificarDecision distingue bloqueado, observado y paso', () => {
    assert.strictEqual(clasificarDecision(decision({ blocked: true })), 'bloqueado');
    assert.strictEqual(clasificarDecision(decision({ observed: 'motivo' })), 'observado');
    assert.strictEqual(clasificarDecision(decision({ observed: false })), 'paso');
  });
});
