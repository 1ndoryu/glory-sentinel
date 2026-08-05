/* [028A-6 Fase 4] Casos límite del guard: el descubrimiento de la raíz debe
 * funcionar desde subdirectorios anidados, tras mover el repositorio, con y
 * sin política en el mismo árbol (simula checkout de ramas) y a través de
 * junctions (realpath resuelve la ruta física). La junction se crea con
 * mklink /J (sin admin) y se salta si la plataforma o el comando fallan.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { inspectDirectCommand, QUALITY_GUARD_EXIT_CODE } from '../../core/guardCommand';
import { copyFixtureToTmp, v2Policy } from './guardMatrixCommon';

suite('Sentinel guard casos límite (Fase 4)', () => {
  const cleanup: string[] = [];

  suiteTeardown(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('raíz encontrada desde un subdirectorio anidado', async () => {
    const root = copyFixtureToTmp('node-project');
    cleanup.push(path.dirname(root));
    const nested = path.join(root, 'src', 'deep', 'nested', 'dir');
    fs.mkdirSync(nested, { recursive: true });
    const decision = await inspectDirectCommand({ executable: 'npm', args: ['run', 'test'], projectRoot: nested });
    assert.strictEqual(decision.blocked, true);
    assert.strictEqual(decision.exitCode, QUALITY_GUARD_EXIT_CODE);
    assert.strictEqual(decision.root, path.resolve(root));
  });

  test('repositorio movido: la política se re-descubre en la nueva ubicación', async () => {
    const root = copyFixtureToTmp('rust-project');
    const movedParent = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-moved-'));
    const moved = path.join(movedParent, 'moved-location');
    fs.renameSync(root, moved);
    cleanup.push(movedParent);
    const decision = await inspectDirectCommand({ executable: 'cargo', args: ['test'], projectRoot: moved });
    assert.strictEqual(decision.blocked, true);
    assert.strictEqual(decision.policyStatus, 'policy');
    assert.strictEqual(decision.root, path.resolve(moved));
  });

  test('rama con/sin política en el mismo árbol: toggle del marcador', async () => {
    const root = copyFixtureToTmp('no-policy-project');
    cleanup.push(path.dirname(root));
    const policyPath = path.join(root, 'sentinel.config.json');
    const without = await inspectDirectCommand({ executable: 'npm', args: ['run', 'test'], projectRoot: root });
    assert.strictEqual(without.blocked, false);
    assert.strictEqual(without.policyStatus, undefined);
    fs.writeFileSync(policyPath, v2Policy('enforce', {
      npmScripts: ['test'],
      npxTools: [],
      cargoSubcommands: [],
      tools: [],
    }), 'utf8');
    const withPolicy = await inspectDirectCommand({ executable: 'npm', args: ['run', 'test'], projectRoot: root });
    assert.strictEqual(withPolicy.blocked, true);
    assert.strictEqual(withPolicy.policyStatus, 'policy');
  });

  test('junction al proyecto: el guard resuelve la ruta física y aplica la política', async () => {
    if (process.platform !== 'win32') return;
    const root = copyFixtureToTmp('node-project');
    const junctionParent = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-junction-'));
    cleanup.push(path.dirname(root), junctionParent);
    const junction = path.join(junctionParent, 'linked-project');
    const created = spawnSync('cmd.exe', ['/c', 'mklink', '/J', junction, root], { encoding: 'utf8', windowsHide: true });
    if (created.status !== 0 || !fs.existsSync(junction)) return; /* Junction no soportada: skip. */
    try {
      const decision = await inspectDirectCommand({ executable: 'npm', args: ['run', 'test'], projectRoot: junction });
      assert.strictEqual(decision.blocked, true);
      assert.strictEqual(decision.exitCode, QUALITY_GUARD_EXIT_CODE);
    } finally {
      /* [028A-6] Windows no permite borrar una junction con rmSync (EPERM);
       * se retira con rmdir y el directorio padre queda vacío para cleanup. */
      spawnSync('cmd.exe', ['/c', 'rmdir', junction], { encoding: 'utf8', windowsHide: true });
    }
  });
});
