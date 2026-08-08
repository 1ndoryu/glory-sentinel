/* [028A-6 Fase 4] Matriz real de shells: los shims generados por el runtime
 * (npm/npx/cargo/node.cmd) en un PATH de sandbox y los guards dot-sourceables
 * (bash/PowerShell) interceptan comandos directos en cmd, PowerShell 5.1,
 * PowerShell 7 y Bash/Git Bash. Cada caso declara la decisión esperada:
 * bloqueado (78), pasa (0) o bypass documentado (rutas absolutas / shell sin
 * perfil: requieren enforcement del launcher, no son interceptables por
 * scripts del repositorio). Los shells ausentes se saltan, no fallan.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bashAvailable,
  cmdAvailable,
  copyFixtureToTmp,
  powershellAvailable,
  pwshAvailable,
  runInShell,
  sandboxEnv,
  shellAvailable,
  writeSandboxRuntime,
} from './guardMatrixCommon';

const REPO_ROOT = path.resolve(__dirname, '../../..');

const shellSuite = suite('Sentinel guard matrix real de shells (Fase 4)', () => {
  let shimDir: string;
  let targetRoot: string;
  let nodeRoot: string;
  let rustRoot: string;
  let env: NodeJS.ProcessEnv;
  const cleanup: string[] = [];

  suiteSetup(async () => {
    targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-shell-target-'));
    cleanup.push(targetRoot);
    shimDir = await writeSandboxRuntime(targetRoot, REPO_ROOT);
    nodeRoot = copyFixtureToTmp('node-project');
    rustRoot = copyFixtureToTmp('rust-project');
    /* [028A-6] package.json con script real solo para demostrar el bypass de
     * bash sin perfil (el npm real ejecutaría el script). Los casos bloqueados
     * nunca llegan a ejecutar el real. */
    fs.writeFileSync(path.join(nodeRoot, 'package.json'), JSON.stringify({
      name: 'matrix-node',
      scripts: { test: "node -e \"console.log('real-npm-ran')\"" },
    }), 'utf8');
    cleanup.push(path.dirname(nodeRoot), path.dirname(rustRoot));
    env = sandboxEnv(shimDir);
  });

  suiteTeardown(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('un probe no cero no declara el shell disponible', () => {
    assert.strictEqual(shellAvailable(process.execPath, ['-e', 'process.exit(0)']), true);
    assert.strictEqual(shellAvailable(process.execPath, ['-e', 'process.exit(1)']), false);
  });

  test('cmd: npm run test bloqueado (78) y npm --version pasa', () => {
    if (!cmdAvailable()) return;
    const comspec = process.env.ComSpec ?? 'cmd.exe';
    const blocked = runInShell(comspec, ['/c', 'npm run test'], nodeRoot, env);
    assert.strictEqual(blocked.status, 78, `esperado 78, got ${blocked.status}\n${blocked.stdout}\n${blocked.stderr}`);
    /* [028A-6] El mensaje del guard se escribe en stderr (no contamina stdout). */
    assert.match(blocked.stderr, /BLOQUEADO/);
    const passed = runInShell(comspec, ['/c', 'npm --version'], nodeRoot, env);
    assert.strictEqual(passed.status, 0);
    assert.match(passed.stdout, /\d+\.\d+\.\d+/);
  });

  test('cmd: npx vitest y cargo test bloqueados (78)', () => {
    if (!cmdAvailable()) return;
    const comspec = process.env.ComSpec ?? 'cmd.exe';
    const npxRun = runInShell(comspec, ['/c', 'npx vitest run'], nodeRoot, env);
    assert.strictEqual(npxRun.status, 78, npxRun.stdout + npxRun.stderr);
    const cargoRun = runInShell(comspec, ['/c', 'cargo test'], rustRoot, env);
    assert.strictEqual(cargoRun.status, 78, cargoRun.stdout + cargoRun.stderr);
  });

  test('cmd: un pipe 2>&1 enmascara el exit code del guard (documentado)', () => {
    if (!cmdAvailable()) return;
    const comspec = process.env.ComSpec ?? 'cmd.exe';
    /* El último comando del pipe decide el exit: findstr encuentra el texto
     * del bloqueo y sale 0 — el código 78 queda enmascarado. Límite inherente
     * de intercepción por PATH en pipes, documentado para agentes. */
    const piped = runInShell(comspec, ['/c', 'npm run test 2>&1 | findstr BLOQUEADO'], nodeRoot, env);
    assert.strictEqual(piped.status, 0);
    assert.match(piped.stdout, /BLOQUEADO/);
  });

  test('powershell 5.1: shim de PATH bloquea (78) y dot-source del guard también', () => {
    if (!powershellAvailable()) return;
    const byPath = runInShell('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'npm run test; exit $LASTEXITCODE'], nodeRoot, env);
    assert.strictEqual(byPath.status, 78, byPath.stdout + byPath.stderr);
    const shim = shimDir.replace(/'/g, "''");
    const fixture = nodeRoot.replace(/'/g, "''");
    const dotSourced = runInShell('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `. '${shim}\\global-cargo-guard.ps1'; Set-Location '${fixture}'; npm run test; exit $LASTEXITCODE`,
    ], nodeRoot, env);
    assert.strictEqual(dotSourced.status, 78, dotSourced.stdout + dotSourced.stderr);
  });

  test('powershell 7 (pwsh): shim de PATH y dot-source bloquean (78)', () => {
    if (!pwshAvailable()) return;
    const byPath = runInShell('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'npm run test; exit $LASTEXITCODE'], nodeRoot, env);
    assert.strictEqual(byPath.status, 78, byPath.stdout + byPath.stderr);
    const shim = shimDir.replace(/'/g, "''");
    const fixture = nodeRoot.replace(/'/g, "''");
    const dotSourced = runInShell('pwsh', [
      '-NoProfile', '-NonInteractive', '-Command',
      `. '${shim}\\global-cargo-guard.ps1'; Set-Location '${fixture}'; npm run test; exit $LASTEXITCODE`,
    ], nodeRoot, env);
    assert.strictEqual(dotSourced.status, 78, dotSourced.stdout + dotSourced.stderr);
  });

  test('bash: guard dot-sourceado bloquea (78); sin perfil el shim PATH no aplica (bypass documentado)', () => {
    if (!bashAvailable()) return;
    const shim = shimDir.replace(/'/g, "''");
    const fixture = nodeRoot.replace(/'/g, "''");
    const sourced = runInShell('bash', ['-c', `. '${shim}/global-quality-guard.sh'; cd '${fixture}'; npm run test; echo "EXIT:$?"`], nodeRoot, env);
    assert.strictEqual(sourced.status, 0, sourced.stdout + sourced.stderr);
    assert.match(sourced.stdout, /EXIT:78/);
    /* Sin dot-source el npm real de Git Bash corre el script: el shim .cmd no
     * intercepta bash. Requiere enforcement del launcher (límite conocido). */
    const bypass = runInShell('bash', ['-c', `cd '${fixture}'; npm run test`], nodeRoot, env);
    assert.strictEqual(bypass.status, 0);
    assert.match(bypass.stdout, /real-npm-ran/);
  });

  test('bash: npm --version pasa con el guard dot-sourceado', () => {
    if (!bashAvailable()) return;
    const shim = shimDir.replace(/'/g, "''");
    const passed = runInShell('bash', ['-c', `. '${shim}/global-quality-guard.sh'; npm --version`], nodeRoot, env);
    assert.strictEqual(passed.status, 0);
    assert.match(passed.stdout, /\d+\.\d+\.\d+/);
  });
});

/* [028A-6] Los spawns reales de shells (npm --version, guard por invocación)
 * superan el timeout default de mocha (10s); el timeout se aplica a la suite
 * completa tras el registro. */
shellSuite.timeout(120_000);
