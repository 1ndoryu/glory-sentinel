/* [108A-1 Fase 1] Pruebas de proceso sobre el CLI real compilado
 * (out/cli/index.js en Node puro, sin mocks de VS Code): stdout es un único
 * JSON parseable en `--format json`, los diagnósticos del analyzer van a
 * stderr, `--output` y stdout producen el mismo schema, doctor separa
 * readyForAnalyze de readyForGate (no-policy nunca gate-ready) y
 * `check --dry-run` es estrictamente no mutante.
 *
 * Fallaban ANTES del fix de Fase 1: el fallback del logger sin canal usaba
 * console.log y contaminaba stdout con prefijos [INFO]/[WARN] antes del
 * documento JSON solicitado, rompiendo `sentinel analyze --format json |
 * parser`; detectScope escribía changed-files.txt/scope-manifest.json incluso
 * en dry-run; y runCheck emitía leases aunque no hubiera etapas que eximir. */
import * as assert from 'assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SENTINEL_JSON_SCHEMA_VERSION } from '../../cli';

const CLI = path.resolve(__dirname, '../../cli/index.js');

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.notStrictEqual(result.status, null, `el proceso CLI debe terminar; args=${args.join(' ')}`);
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(result.status, 0, `git ${args.join(' ')} falló: ${result.stderr}`);
}

function parseJsonOutput(raw: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(raw.trim()) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label}: stdout no es un único JSON parseable: ${String(error)}\nstdout=${raw}`);
  }
}

/* Workspace con un archivo bajo legacy/services/: el apiEndpointAnalyzer emite
 * un WARN cuando falta openapi.json, que debe viajar por stderr. Con seedGit
 * se inicializa además un repo Git con un commit (necesario para detectScope). */
function makeWorkspace(seedGit: boolean): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-cli-'));
  const services = path.join(workspace, 'legacy', 'services');
  fs.mkdirSync(services, { recursive: true });
  fs.writeFileSync(path.join(services, 'foo.ts'), 'export const value = 1;\n', 'utf8');
  fs.writeFileSync(path.join(workspace, 'seed.txt'), 'seed\n', 'utf8');
  if (seedGit) {
    runGit(workspace, ['init', '-q', '-b', 'f1-test']);
    runGit(workspace, ['config', 'user.email', 't@t']);
    runGit(workspace, ['config', 'user.name', 't']);
    runGit(workspace, ['add', '-A']);
    runGit(workspace, ['commit', '-qm', 'seed']);
  }
  return workspace;
}

function treeFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  };
  walk(root);
  return files.sort();
}

suite('CLI de proceso — stdout/stderr, doctor y dry-run (108A-1 Fase 1)', () => {
  test('analyze --format json: stdout es un único JSON y los diagnósticos del analyzer van a stderr', () => {
    const workspace = makeWorkspace(false);
    try {
      const result = runCli(['analyze', '--workspace', workspace, '--format', 'json'], workspace);
      assert.strictEqual(result.status, 0, `exit 0 esperado; stderr=${result.stderr}`);
      const parsed = parseJsonOutput(result.stdout, 'analyze --format json');
      assert.strictEqual(parsed.schemaVersion, SENTINEL_JSON_SCHEMA_VERSION);
      assert.ok(Array.isArray(parsed.entries));
      assert.ok(!/\[INFO\]|\[WARN\]/u.test(result.stdout), 'stdout no debe contener prefijos de log');
      assert.match(result.stderr, /\[WARN\]/u, 'los diagnósticos del analyzer deben ir a stderr');
      assert.match(result.stderr, /GloryAnalyzer|apiEndpoint/u, 'warnings de GloryAnalyzer en stderr');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('--output y stdout producen el mismo schema JSON', () => {
    const workspace = makeWorkspace(false);
    try {
      const outputPath = path.join(workspace, 'report.json');
      const viaStdout = runCli(['analyze', '--workspace', workspace, '--format', 'json'], workspace);
      const viaFile = runCli(['analyze', '--workspace', workspace, '--format', 'json', '--output', outputPath], workspace);
      assert.strictEqual(viaFile.status, 0, `exit 0 esperado; stderr=${viaFile.stderr}`);
      const normalize = (json: Record<string, unknown>): Record<string, unknown> => {
        const copy = { ...json };
        delete copy.durationMs; // varía entre ejecuciones
        return copy;
      };
      const fromFile = JSON.parse(fs.readFileSync(outputPath, 'utf8').trim()) as Record<string, unknown>;
      assert.deepStrictEqual(normalize(parseJsonOutput(viaStdout.stdout, 'stdout')), normalize(fromFile));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('doctor --json separa readyForAnalyze de readyForGate; no-policy nunca gate-ready', () => {
    const workspace = makeWorkspace(false);
    try {
      const result = runCli(['doctor', '--json', '--workspace', workspace], workspace);
      assert.strictEqual(result.status, 0, `doctor no-policy es analyze-ready; stderr=${result.stderr}`);
      const diagnosis = parseJsonOutput(result.stdout, 'doctor --json');
      assert.strictEqual(diagnosis.readyForAnalyze, true, 'el analizador puede correr en un workspace no-policy');
      assert.strictEqual(diagnosis.readyForGate, false, 'no-policy nunca declara gate listo');
      assert.strictEqual((diagnosis.policy as { status?: string }).status, 'no-policy');
      const text = runCli(['doctor', '--workspace', workspace], workspace);
      assert.match(text.stdout, /Análisis: listo/u);
      assert.match(text.stdout, /Gate: no listo \(política no-policy\)/u);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('check --dry-run es estrictamente no mutante (sin reportes, scopes ni leases)', () => {
    const workspace = makeWorkspace(true);
    try {
      const before = treeFiles(workspace);
      const result = runCli(['check', 'T-1', '--dry-run', '--workspace', workspace], workspace);
      assert.strictEqual(result.status, 0, `dry-run debe terminar exit 0; stderr=${result.stderr}`);
      const scope = parseJsonOutput(result.stdout, 'check --dry-run');
      assert.ok('base' in scope && 'files' in scope, 'el scope JSON debe exponer base/files');
      const after = treeFiles(workspace);
      assert.deepStrictEqual(after, before, 'dry-run no debe crear ni modificar archivos');
      assert.ok(
        !after.some(file => /\.quality-reports|changed-files\.txt|scope-manifest\.json/u.test(file)),
        'sin artefactos de scope/reporte tras dry-run',
      );
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
