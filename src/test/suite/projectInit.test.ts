/* [108A-1 Fase 4] Tests del bootstrap reproducible: sentinel init/migrate/
 * uninit. Cubren presets válidos (schema v2), plan sin mutación, idempotencia,
 * conflictos con --force y backup, migrate SOLO-descubrimiento (nunca borra),
 * uninit limitado a lo administrado, y los comandos reales del CLI. */
import * as assert from 'assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readV2GuardPolicy } from '../../core/guardCommand';
import { validateSentinelConfig } from '../../core/config';
import {
  STACK_PRESETS,
  applyInit,
  applyUninit,
  discoverLegacy,
  planInit,
  planUninit,
} from '../../core/projectInit';

const CLI = path.resolve(__dirname, '../../cli/index.js');

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(result.status, 0, `git ${args.join(' ')} falló: ${result.stderr}`);
}

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-init-'));
  runGit(root, ['init', '-q', '-b', 'wandorius']);
  runGit(root, ['config', 'user.email', 'init@test.local']);
  runGit(root, ['config', 'user.name', 'init']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n', 'utf8');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '-qm', 'seed']);
  return root;
}

function runCli(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

suite('Bootstrap reproducible — sentinel init/migrate/uninit (108A-1 Fase 4)', () => {
  test('presets generan política v2 válida (validateSentinelConfig + readV2GuardPolicy)', async () => {
    const roots: string[] = [];
    try {
      for (const preset of Object.keys(STACK_PRESETS)) {
        /* repo fresco por preset: cada política es independiente */
        const root = makeRepo();
        roots.push(root);
        const plan = await planInit({ preset: preset as never, projectRoot: root });
        const config = JSON.parse(plan.files.find(file => file.path.endsWith('sentinel.config.json'))?.content ?? '{}');
        assert.doesNotThrow(() => validateSentinelConfig(config), `preset ${preset} pasa el schema`);
        fs.writeFileSync(path.join(root, 'sentinel.config.json'), JSON.stringify(config), 'utf8');
        const policy = readV2GuardPolicy(root);
        assert.strictEqual(policy.status, 'policy', `preset ${preset} es política v2 válida`);
        assert.ok(['node', 'rust', 'python', 'mixed'].includes(preset));
      }
    } finally {
      for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('init detecta la rama real (no asume main) y el plan dry-run no muta', async () => {
    const root = makeRepo();
    try {
      const plan = await planInit({ preset: 'node', projectRoot: root, dryRun: true });
      assert.strictEqual(plan.primaryBranch, 'wandorius');
      assert.ok(plan.files.every(file => file.action === 'create' || file.action === 'skip'));
      assert.ok(!fs.existsSync(path.join(root, 'sentinel.config.json')), 'dry-run no escribe');
      assert.ok(!fs.existsSync(path.join(root, '.sentinel')), 'dry-run no crea metadata');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('init es idempotente: segundo plan marca skip para contenido idéntico', async () => {
    const root = makeRepo();
    try {
      const first = await planInit({ preset: 'rust', projectRoot: root });
      await applyInit(first, root);
      const second = await planInit({ preset: 'rust', projectRoot: root });
      assert.ok(second.files.every(file => file.action === 'skip'), 'contenido idéntico → skip');
      assert.deepStrictEqual(second.conflicts, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('config previa sin --force es conflicto y no se aplica; con --force respalda y sobrescribe', async () => {
    const root = makeRepo();
    try {
      fs.writeFileSync(path.join(root, 'sentinel.config.json'), '{ "ajeno": true }\n', 'utf8');
      const conflict = await planInit({ preset: 'node', projectRoot: root });
      assert.ok(conflict.conflicts.includes('sentinel.config.json'), 'config ajeno = conflicto');
      /* applyInit sin --force nunca debe tocar el conflicto: el plan no lo
       * incluye entre files, así que applyInit solo escribiría el resto;
       * el handler del CLI lo bloquea con exit 1. Verificamos el plan. */
      assert.ok(!conflict.files.some(file => file.path.endsWith('sentinel.config.json')), 'el conflicto no se aplica');
      const forced = await planInit({ preset: 'node', projectRoot: root, force: true });
      assert.strictEqual(forced.conflicts.length, 0);
      const applied = await applyInit(forced, root);
      assert.ok(applied.backedUp.some(entry => entry.includes('sentinel.config.json')), 'backup previo al sobrescribir');
      assert.ok(fs.readFileSync(path.join(root, 'sentinel.config.json'), 'utf8').includes('schemaVersion'), 'config regenerada');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('migrate descubre gate/scripts legacy y nunca borra nada', async () => {
    const root = makeRepo();
    try {
      fs.mkdirSync(path.join(root, 'scripts', 'quality'), { recursive: true });
      fs.writeFileSync(path.join(root, 'quality.config.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(root, 'quality-tools.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'task:check': 'node scripts/quality/task-check.mjs' } }), 'utf8');
      const before = fs.readdirSync(path.join(root, 'scripts'));
      const inventory = await discoverLegacy(root);
      assert.ok(inventory.markers.some(marker => marker.kind === 'scripts-quality'));
      assert.ok(inventory.markers.some(marker => marker.kind === 'gate-config'));
      assert.ok(inventory.customScripts.some(script => script.name === 'task:check'));
      assert.ok(inventory.risks.length > 0);
      assert.deepStrictEqual(fs.readdirSync(path.join(root, 'scripts')), before, 'dry-run no borra scripts');
      assert.ok(fs.existsSync(path.join(root, 'scripts', 'quality')), 'cobertura intacta');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('uninit retira SOLO lo administrado por init-manifest', async () => {
    const root = makeRepo();
    try {
      const unknown = await planUninit(root);
      assert.strictEqual(unknown.unknown, true, 'sin init-manifest: nada administrado');
      await assert.rejects(() => applyUninit(root), /nada administrado/);

      const plan = await planInit({ preset: 'mixed', projectRoot: root });
      await applyInit(plan, root);
      fs.writeFileSync(path.join(root, 'archivo-ajeno.txt'), 'no tocar\n', 'utf8');
      const uninit = await planUninit(root);
      assert.strictEqual(uninit.unknown, false);
      assert.ok(uninit.adminFiles.includes('sentinel.config.json'));
      const removed = await applyUninit(root);
      assert.ok(removed.includes('sentinel.config.json'));
      assert.ok(!fs.existsSync(path.join(root, 'sentinel.config.json')), 'config retirada');
      assert.ok(fs.existsSync(path.join(root, 'archivo-ajeno.txt')), 'archivo ajeno intacto');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('CLI real: init → doctor readyForGate true; migrate/uninit dry-run no mutan', () => {
    const root = makeRepo();
    try {
      const init = runCli(root, ['init', '--preset', 'node', '--project-root', root]);
      assert.strictEqual(init.status, 0, init.stderr);
      assert.ok(fs.existsSync(path.join(root, 'sentinel.config.json')));

      const doctor = runCli(root, ['doctor', '--json', '--workspace', root]);
      const diagnosis = JSON.parse(doctor.stdout.trim()) as { readyForGate?: boolean; readyForAnalyze?: boolean; issues: unknown[] };
      assert.strictEqual(diagnosis.readyForGate, true, 'readyForGate true tras init completo');
      assert.strictEqual(diagnosis.readyForAnalyze, true);
      assert.strictEqual(diagnosis.issues.length, 0);

      const migrate = runCli(root, ['migrate', '--project-root', root]);
      assert.strictEqual(migrate.status, 0, migrate.stderr);
      assert.match(migrate.stdout, /inventario legacy/);

      const uninitDry = runCli(root, ['uninit', '--project-root', root, '--dry-run']);
      assert.strictEqual(uninitDry.status, 0, uninitDry.stderr);
      assert.match(uninitDry.stdout, /sentinel\.config\.json/);
      assert.ok(fs.existsSync(path.join(root, 'sentinel.config.json')), 'dry-run no retira');

      const uninit = runCli(root, ['uninit', '--project-root', root]);
      assert.strictEqual(uninit.status, 0, uninit.stderr);
      assert.ok(!fs.existsSync(path.join(root, 'sentinel.config.json')), 'uninit real retira lo administrado');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('CLI real: init --json aplica el bootstrap y no solo lo anuncia', () => {
    const root = makeRepo();
    try {
      const init = runCli(root, ['init', '--preset', 'node', '--project-root', root, '--json']);
      assert.strictEqual(init.status, 0, init.stderr);
      const result = JSON.parse(init.stdout.trim()) as { dryRun?: boolean; applied?: string[] };
      assert.strictEqual(result.dryRun, false);
      assert.ok(result.applied?.includes('sentinel.config.json'));
      assert.ok(fs.existsSync(path.join(root, 'sentinel.config.json')), 'init --json escribe la configuración');
      assert.ok(fs.existsSync(path.join(root, 'sentinel.lock.json')), 'init --json escribe el lock');
      assert.ok(fs.existsSync(path.join(root, '.sentinel', 'init-manifest.json')), 'init --json escribe el manifiesto');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
