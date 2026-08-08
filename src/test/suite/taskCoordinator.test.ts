import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { provisionTaskInputs, validateIgnoredInputs } from '../../core/envManifest';
import {
  TASK_TTL_MS,
  claimTask,
  cleanupTask,
  heartbeatTask,
  integrateTask,
  verifyTaskWorktree,
  releaseTask,
  startTask,
  taskStatus,
} from '../../core/taskCoordinator';

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const PRIMARY_BRANCH = 'wandorius';

function fixture(): { parent: string; root: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-task-'));
  const root = path.join(parent, 'repo');
  fs.mkdirSync(root);
  git(root, ['init', '-q', '-b', PRIMARY_BRANCH]);
  git(root, ['config', 'user.email', 'sentinel@example.test']);
  git(root, ['config', 'user.name', 'Sentinel Test']);
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n', 'utf8');
  git(root, ['add', 'base.txt']);
  git(root, ['commit', '-q', '-m', 'base']);
  return { parent, root };
}

const taskCoordinatorSuite = suite('task coordinator', () => {
  test('solo un agente gana dos claims concurrentes para la misma tarea', async () => {
    const { parent, root } = fixture();
    try {
      const results = await Promise.allSettled([
        claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-1', agent: 'agent-a' }),
        claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-1', agent: 'agent-b' }),
      ]);
      assert.strictEqual(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.strictEqual(results.filter(result => result.status === 'rejected').length, 1);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('status all conserva historial de una tarea liberada y detecta metadata descriptiva', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'HISTORY-1', agent: 'agent-a', summary: 'Liberar tarea', planReference: 'Agente/planes/history.md' });
      await releaseTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'HISTORY-1', agent: 'agent-a' });
      const status = await taskStatus(root, PRIMARY_BRANCH, true);
      assert.strictEqual(status.tasks.length, 0);
      assert.strictEqual(status.history.length, 1);
      assert.strictEqual(status.history[0].terminalState, 'RELEASED');
      assert.strictEqual(status.history[0].record.planReference, 'Agente/planes/history.md');
      assert.ok(status.history[0].record.history?.some(event => event.action === 'RELEASE'));
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('rechaza referencias de plan absolutas o con traversal', async () => {
    const { parent, root } = fixture();
    try {
      await assert.rejects(claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'BAD-PLAN', agent: 'agent-a', planReference: '../secreto.md' }), /planReference debe ser/);
      await assert.rejects(claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'BAD-PLAN2', agent: 'agent-a', planReference: path.join(parent, 'secreto.md') }), /planReference debe ser/);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('rechaza takeover silencioso y exige force cuando la toma expiró', async () => {
    const { parent, root } = fixture();
    try {
      const now = Date.now();
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-2', agent: 'agent-a', now: now - TASK_TTL_MS - 1 });
      await assert.rejects(
        claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-2', agent: 'agent-b', now }),
        /force\/takeover explícito/,
      );
      const taken = await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-2', agent: 'agent-b', now, force: true });
      assert.strictEqual(taken.agent, 'agent-b');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('start exige la rama principal declarada y conserva la rama custom', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-3', agent: 'agent-a' });
      const task = await startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-3', agent: 'agent-a' });
      assert.strictEqual(git(root, ['status', '--porcelain']).replace(/^\?\? \.sentinel\/?$/mu, ''), '');
      assert.strictEqual(git(root, ['branch', '--show-current']), PRIMARY_BRANCH);
      assert.ok(path.resolve(task.worktree!).startsWith(path.resolve(root, '.sentinel', 'worktrees') + path.sep));
      await assert.rejects(
        startTask({ projectRoot: root, primaryBranch: 'main', taskId: 'T-3', agent: 'agent-a' }),
        /toma inválida o expirada/,
      );
      assert.match(git(task.worktree!, ['branch', '--show-current']), /^task\/[a-f0-9]{16}\/T-3$/u);
      assert.strictEqual(fs.existsSync(task.worktree!), true);
      await assert.rejects(startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-3', agent: 'agent-a' }), /estado ACTIVE/);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('rechaza worktree solicitado fuera de glory-rust-template', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'ESCAPE', agent: 'agent-a' });
      await assert.rejects(
        startTask({
          projectRoot: root,
          primaryBranch: PRIMARY_BRANCH,
          taskId: 'ESCAPE',
          agent: 'agent-a',
          worktreePath: path.join(parent, 'outside-worktree'),
        }),
        /debe estar dentro de .*\\.sentinel[\\\\/]worktrees.*rutas externas/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('worktreesRoot externo autorizado crea el worktree visible dentro de esa raíz', async () => {
    const { parent, root } = fixture();
    try {
      const externalRoot = path.join(parent, 'visible-worktrees');
      fs.mkdirSync(externalRoot);
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'VISIBLE', agent: 'agent-a' });
      const task = await startTask({
        projectRoot: root,
        primaryBranch: PRIMARY_BRANCH,
        taskId: 'VISIBLE',
        agent: 'agent-a',
        worktreesRoot: externalRoot,
      });
      assert.ok(path.resolve(task.worktree!).startsWith(path.resolve(externalRoot) + path.sep));
      assert.strictEqual(path.resolve(task.worktreesRoot!), path.resolve(externalRoot));
      assert.strictEqual(fs.existsSync(task.worktree!), true);
      assert.strictEqual(git(root, ['status', '--porcelain']).replace(/^\?\? \.sentinel\/?$/mu, ''), '');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('worktreesRoot dentro del repositorio se rechaza (no es una raíz externa)', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'INNER', agent: 'agent-a' });
      await assert.rejects(
        startTask({
          projectRoot: root,
          primaryBranch: PRIMARY_BRANCH,
          taskId: 'INNER',
          agent: 'agent-a',
          worktreesRoot: path.join(root, 'inner-worktrees'),
        }),
        /no puede ser el repositorio ni una subcarpeta/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('cleanup valida el path registrado antes de eliminar cualquier worktree', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'TAMPER', agent: 'agent-a' });
      const task = await startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'TAMPER', agent: 'agent-a' });
      const coordination = path.join(root, '.sentinel', 'coordination');
      const projectDirectory = fs.readdirSync(coordination).find(name =>
        fs.statSync(path.join(coordination, name)).isDirectory());
      assert.ok(projectDirectory);
      const metadataPath = path.join(coordination, projectDirectory!, 'TAMPER.json');
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
      const outside = path.join(parent, 'outside-worktree');
      fs.mkdirSync(outside);
      metadata.state = 'INTEGRATED';
      metadata.worktree = outside;
      metadata.head = git(root, ['rev-parse', 'HEAD']);
      fs.writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`, 'utf8');
      await assert.rejects(
        cleanupTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'TAMPER', agent: 'agent-a' }),
        /debe estar dentro de .*\\.sentinel[\\\\/]worktrees.*rutas externas/,
      );
      assert.strictEqual(fs.existsSync(outside), true);
      assert.strictEqual(fs.existsSync(task.worktree!), true);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('integra solo un commit limpio con base estable y limpia repetidamente', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-4', agent: 'agent-a', summary: 'Tarea de prueba', planReference: 'Agente/planes/test.md', relatedTaskIds: ['T-RELATED'] });
      const task = await startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-4', agent: 'agent-a' });
      fs.writeFileSync(path.join(task.worktree!, 'feature.txt'), 'feature\n', 'utf8');
      git(task.worktree!, ['add', 'feature.txt']);
      git(task.worktree!, ['commit', '-q', '-m', 'T-4: feature']);
      const integrated = await integrateTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-4', agent: 'agent-a' });
      assert.strictEqual(integrated.state, 'INTEGRATED');
      assert.strictEqual(integrated.summary, 'Tarea de prueba');
      assert.deepStrictEqual(integrated.relatedTaskIds, ['T-RELATED']);
      assert.ok((integrated.history ?? []).some(event => event.action === 'INTEGRATE'));
      assert.ok((integrated.commits ?? []).length >= 1);
      assert.deepStrictEqual(integrated.changedFiles, ['feature.txt']);
      assert.strictEqual(fs.existsSync(path.join(root, 'feature.txt')), true);
      await cleanupTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-4', agent: 'agent-a' });
      await cleanupTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-4', agent: 'agent-a' });
      const status = await taskStatus(root, PRIMARY_BRANCH, true);
      assert.strictEqual(status.tasks.length, 0);
      assert.strictEqual(status.history.length, 1);
      assert.strictEqual(status.history[0].terminalState, 'CLEANED');
      assert.strictEqual(status.orphanWorktrees.length, 0);
      assert.strictEqual(git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/task/']).includes('/T-4'), false);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('aísla dos proyectos del mismo repositorio aunque compartan task-id', async () => {
    const { parent, root } = fixture();
    const secondary = 'template';
    try {
      git(root, ['branch', secondary]);
      const first = await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'SHARED', agent: 'agent-a' });
      const second = await claimTask({ projectRoot: root, primaryBranch: secondary, taskId: 'SHARED', agent: 'agent-b' });
      const firstStarted = await startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: first.taskId, agent: first.agent });
      const secondStarted = await startTask({ projectRoot: root, primaryBranch: secondary, taskId: second.taskId, agent: second.agent });
      assert.notStrictEqual(firstStarted.branch, secondStarted.branch);
      assert.notStrictEqual(firstStarted.worktree, secondStarted.worktree);
      assert.strictEqual((await taskStatus(root, PRIMARY_BRANCH)).tasks.length, 1);
      assert.strictEqual((await taskStatus(root, secondary)).tasks.length, 1);
      fs.writeFileSync(path.join(firstStarted.worktree!, 'first.txt'), 'first\n', 'utf8');
      git(firstStarted.worktree!, ['add', 'first.txt']);
      git(firstStarted.worktree!, ['commit', '-q', '-m', 'SHARED: first']);
      fs.writeFileSync(path.join(secondStarted.worktree!, 'second.txt'), 'second\n', 'utf8');
      git(secondStarted.worktree!, ['add', 'second.txt']);
      git(secondStarted.worktree!, ['commit', '-q', '-m', 'SHARED: second']);
      await integrateTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'SHARED', agent: 'agent-a' });
      git(root, ['checkout', '-q', secondary]);
      await integrateTask({ projectRoot: root, primaryBranch: secondary, taskId: 'SHARED', agent: 'agent-b' });
      await cleanupTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'SHARED', agent: 'agent-a' });
      await cleanupTask({ projectRoot: root, primaryBranch: secondary, taskId: 'SHARED', agent: 'agent-b' });
      git(root, ['checkout', '-q', PRIMARY_BRANCH]);
      assert.strictEqual((await taskStatus(root, PRIMARY_BRANCH)).tasks.length, 0);
      assert.strictEqual((await taskStatus(root, secondary)).tasks.length, 0);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('rechaza gate en el checkout principal y conserva el heartbeat activo', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-6', agent: 'agent-a' });
      const task = await startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-6', agent: 'agent-a' });
      await assert.rejects(
        verifyTaskWorktree({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-6', agent: 'agent-a' }),
        /no coincide con el worktree/,
      );
      const heartbeat = await heartbeatTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-6', agent: 'agent-a' });
      assert.strictEqual(heartbeat.state, 'ACTIVE');
      const status = await taskStatus(root, PRIMARY_BRANCH);
      assert.strictEqual(status.tasks.length, 1);
      assert.strictEqual(status.tasks[0].expired, false);
      assert.strictEqual(status.tasks[0].processAlive, true);
      assert.strictEqual(status.tasks[0].worktreeClean, true);
      assert.ok(task.worktree);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('rechaza integrar una tarea expirada sin takeover explícito', async () => {
    const { parent, root } = fixture();
    try {
      const now = Date.now();
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-7', agent: 'agent-a', now: now - TASK_TTL_MS - 1 });
      const task = await startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-7', agent: 'agent-a', now: now - TASK_TTL_MS - 1 });
      fs.writeFileSync(path.join(task.worktree!, 'feature.txt'), 'feature\n', 'utf8');
      git(task.worktree!, ['add', 'feature.txt']);
      git(task.worktree!, ['commit', '-q', '-m', 'T-7: feature']);
      await assert.rejects(
        integrateTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-7', agent: 'agent-a', now }),
        /toma expirada/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('bloquea integración con target sucio y release cruzado', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-5', agent: 'agent-a' });
      await startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-5', agent: 'agent-a' });
      fs.writeFileSync(path.join(root, 'uncommitted.txt'), 'dirty\n', 'utf8');
      await assert.rejects(
        integrateTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-5', agent: 'agent-a' }),
        /target sucio/,
      );
      await assert.rejects(
        releaseTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'T-5', agent: 'agent-b' }),
        /pertenece a agent-a/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});

/* La suite crea y elimina worktrees Git reales. En Windows sobre carpetas
 * sincronizadas, una corrida válida puede superar el timeout unitario de 10 s. */
taskCoordinatorSuite.timeout(30_000);


suite('env manifest provisioning ([VISIBLE-WORKTREE])', () => {
  function writeManifest(root: string, inputs: unknown[]): void {
    fs.writeFileSync(
      path.join(root, 'sentinel.env-manifest.json'),
      JSON.stringify({ schemaVersion: 1, inputs }),
      'utf8',
    );
    git(root, ['add', 'sentinel.env-manifest.json']);
    git(root, ['commit', '-q', '-m', 'env manifest']);
  }

  test('provisiona ignored-local desde su fuente declarada y deja el worktree limpio para el gate', async () => {
    const { parent, root } = fixture();
    try {
      fs.writeFileSync(path.join(root, '.gitignore'), '.env\n', 'utf8');
      fs.writeFileSync(path.join(root, '.env.example'), 'TOKEN=base\n', 'utf8');
      git(root, ['add', '.gitignore', '.env.example']);
      git(root, ['commit', '-q', '-m', 'env template']);
      writeManifest(root, [{ path: '.env', category: 'ignored-local', source: '.env.example', editable: true }]);
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-1', agent: 'agent-a' });
      const started = await startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-1', agent: 'agent-a' });
      assert.strictEqual(fs.readFileSync(path.join(started.worktree!, '.env'), 'utf8'), 'TOKEN=base\n');
      /* Los provisionados son ignorados: el worktree sigue limpio para gate/integrate. */
      assert.strictEqual(git(started.worktree!, ['status', '--porcelain']), '');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('editable true autoriza el cambio de un ignored-local y editable false lo bloquea', async () => {
    const { parent, root } = fixture();
    try {
      fs.writeFileSync(path.join(root, '.gitignore'), '.env\n' + 'otro-local.txt\n', 'utf8');
      fs.writeFileSync(path.join(root, '.env.example'), 'TOKEN=base\n', 'utf8');
      git(root, ['add', '.gitignore', '.env.example']);
      git(root, ['commit', '-q', '-m', 'env template']);
      writeManifest(root, [{ path: '.env', category: 'ignored-local', source: '.env.example', editable: true }]);
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-A', agent: 'agent-a' });
      const editable = await startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-A', agent: 'agent-a' });
      fs.writeFileSync(path.join(editable.worktree!, '.env'), 'TOKEN=edited\n', 'utf8');
      await verifyTaskWorktree({ projectRoot: editable.worktree!, primaryBranch: PRIMARY_BRANCH, taskId: 'M-A', agent: 'agent-a' });
      fs.writeFileSync(path.join(editable.worktree!, 'otro-local.txt'), 'no autorizado\n', 'utf8');
      git(editable.worktree!, ['check-ignore', '-q', 'otro-local.txt']);
      await assert.rejects(
        verifyTaskWorktree({ projectRoot: editable.worktree!, primaryBranch: PRIMARY_BRANCH, taskId: 'M-A', agent: 'agent-a' }),
        /ignored-input no autorizado para la tarea/,
      );

      const second = fixture();
      try {
        fs.writeFileSync(path.join(second.root, '.gitignore'), '.env\n', 'utf8');
        fs.writeFileSync(path.join(second.root, '.env.example'), 'TOKEN=base\n', 'utf8');
        git(second.root, ['add', '.gitignore', '.env.example']);
        git(second.root, ['commit', '-q', '-m', 'env template']);
        writeManifest(second.root, [{ path: '.env', category: 'ignored-local', source: '.env.example', editable: false }]);
        await claimTask({ projectRoot: second.root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-B', agent: 'agent-a' });
        const locked = await startTask({ projectRoot: second.root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-B', agent: 'agent-a' });
        fs.writeFileSync(path.join(locked.worktree!, '.env'), 'TOKEN=edited\n', 'utf8');
        await assert.rejects(
          verifyTaskWorktree({ projectRoot: locked.worktree!, primaryBranch: PRIMARY_BRANCH, taskId: 'M-B', agent: 'agent-a' }),
          /ignored-input no autorizado para edici/,
        );
      } finally {
        fs.rmSync(second.parent, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('editable solo se permite para ignored-local', async () => {
    const { parent, root } = fixture();
    try {
      writeManifest(root, [{ path: 'secret.txt', category: 'secret', editable: true }]);
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-C', agent: 'agent-a' });
      await assert.rejects(
        startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-C', agent: 'agent-a' }),
        /editable solo se permite para ignored-local/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('sin manifiesto conserva el flujo y permite ignorados preexistentes', async () => {
    const { parent, root } = fixture();
    try {
      fs.writeFileSync(path.join(root, '.gitignore'), 'local.txt\n', 'utf8');
      git(root, ['add', '.gitignore']);
      git(root, ['commit', '-q', '-m', 'ignore local']);
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-NONE', agent: 'agent-a' });
      const task = await startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-NONE', agent: 'agent-a' });
      fs.writeFileSync(path.join(task.worktree!, 'local.txt'), 'allowed legacy local\n', 'utf8');
      const verified = await verifyTaskWorktree({ projectRoot: task.worktree!, primaryBranch: PRIMARY_BRANCH, taskId: 'M-NONE', agent: 'agent-a' });
      assert.strictEqual(verified.ignoredBaseline, null);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('fuente faltante produce missing-task-input y no deja worktree ni rama huerfanos', async () => {
    const { parent, root } = fixture();
    try {
      writeManifest(root, [{ path: '.env', category: 'ignored-local', source: 'no-existe.txt' }]);
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-2', agent: 'agent-a' });
      await assert.rejects(
        startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-2', agent: 'agent-a' }),
        /missing-task-input: \.env \(categor/
      );
      const worktrees = git(root, ['worktree', 'list', '--porcelain']);
      assert.ok(!worktrees.includes('M-2'), 'no debe quedar worktree de la tarea');
      assert.strictEqual(git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/task/']).includes('/M-2'), false);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('migra metadata v2 a v3 sin perder la tarea y mantiene schemas desconocidos inválidos', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-MIGRATE', agent: 'agent-a' });
      const coordination = path.join(root, '.sentinel', 'coordination');
      const projectDirectory = fs.readdirSync(coordination).find(name => fs.statSync(path.join(coordination, name)).isDirectory());
      assert.ok(projectDirectory);
      const metadataPath = path.join(coordination, projectDirectory!, 'M-MIGRATE.json');
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
      delete metadata.ignoredInputs;
      delete metadata.ignoredBaseline;
      metadata.schemaVersion = 2;
      fs.writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`, 'utf8');
      const status = await taskStatus(root, PRIMARY_BRANCH);
      assert.strictEqual(status.invalidMetadata.length, 0);
      assert.strictEqual(status.tasks.length, 1);
      const unchanged = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
      assert.strictEqual(unchanged.schemaVersion, 2);
      const migrated = await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-MIGRATE', agent: 'agent-a' });
      assert.strictEqual(migrated.schemaVersion, 3);
      assert.deepStrictEqual(migrated.ignoredInputs, []);
      assert.strictEqual(migrated.ignoredBaseline, null);
      metadata.schemaVersion = 99;
      fs.writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`, 'utf8');
      const invalid = await taskStatus(root, PRIMARY_BRANCH);
      assert.ok(invalid.invalidMetadata.includes('M-MIGRATE.json'));
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('expone metadata v1 de otra rama como legacyOrphan sin resolverla ni mutarla', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'LEGACY-ORPHAN', agent: 'agent-a' });
      const coordination = path.join(root, '.sentinel', 'coordination');
      const projectDirectory = fs.readdirSync(coordination).find(name => fs.statSync(path.join(coordination, name)).isDirectory());
      assert.ok(projectDirectory);
      const metadataPath = path.join(coordination, projectDirectory!, 'LEGACY-ORPHAN.json');
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
      metadata.schemaVersion = 1;
      metadata.target = 'wandorius';
      metadata.branch = 'task/old-namespace/LEGACY-ORPHAN';
      metadata.worktree = path.join(parent, 'missing-worktree');
      fs.writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`, 'utf8');
      const status = await taskStatus(root, PRIMARY_BRANCH, true);
      assert.strictEqual(status.invalidMetadata.length, 0);
      assert.strictEqual(status.tasks.length, 0);
      assert.strictEqual(status.legacyOrphans.length, 1);
      assert.strictEqual(JSON.parse(fs.readFileSync(metadataPath, 'utf8')).schemaVersion, 1);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('valida profundamente eventos y gateRuns manipulados', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'BAD-HISTORY', agent: 'agent-a' });
      const coordination = path.join(root, '.sentinel', 'coordination');
      const projectDirectory = fs.readdirSync(coordination).find(name => fs.statSync(path.join(coordination, name)).isDirectory());
      const metadataPath = path.join(coordination, projectDirectory!, 'BAD-HISTORY.json');
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
      metadata.history = [{ eventId: 'bad', at: 'not-a-date', actor: 'agent-a', action: 'CLAIM', fromState: null, toState: 'CLAIMED' }];
      fs.writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`, 'utf8');
      const status = await taskStatus(root, PRIMARY_BRANCH);
      assert.ok(status.invalidMetadata.includes('BAD-HISTORY.json'));
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('rechaza manifiesto explícito fuera del projectRoot, traversal y symlink externo', async () => {
    const { parent, root } = fixture();
    try {
      const outside = path.join(parent, 'outside-manifest.json');
      fs.writeFileSync(outside, JSON.stringify({ schemaVersion: 1, inputs: [] }), 'utf8');
      fs.writeFileSync(path.join(root, '.gitignore'), 'manifest-link.json\n', 'utf8');
      git(root, ['add', '.gitignore']);
      git(root, ['commit', '-q', '-m', 'manifest path guard']);
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-PATH', agent: 'agent-a' });
      await assert.rejects(
        startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-PATH', agent: 'agent-a', envManifestPath: outside }),
        /debe permanecer dentro del projectRoot/,
      );
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-TRAV', agent: 'agent-a' });
      await assert.rejects(
        startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-TRAV', agent: 'agent-a', envManifestPath: '../outside-manifest.json' }),
        /debe permanecer dentro del projectRoot/,
      );
      const link = path.join(root, 'manifest-link.json');
      try {
        fs.symlinkSync(outside, link, 'file');
      } catch {
        return;
      }
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-LINK', agent: 'agent-a' });
      await assert.rejects(
        startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-LINK', agent: 'agent-a', envManifestPath: link }),
        /(debe permanecer dentro del projectRoot|manifiesto de entorno no encontrado)/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('bloquea modificar o eliminar un ignored-local preexistente no declarado', async () => {
    const { parent, root } = fixture();
    const worktree = path.join(parent, 'baseline-worktree');
    try {
      fs.writeFileSync(path.join(root, '.gitignore'), 'local.txt\n', 'utf8');
      git(root, ['add', '.gitignore']);
      git(root, ['commit', '-q', '-m', 'ignored baseline']);
      git(root, ['worktree', 'add', '-q', '-b', 'baseline-check', worktree, PRIMARY_BRANCH]);
      fs.writeFileSync(path.join(worktree, 'local.txt'), 'local-base\n', 'utf8');
      const manifest = path.join(root, 'empty-manifest.json');
      fs.writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, inputs: [] }), 'utf8');
      const provisioned = await provisionTaskInputs(root, worktree, manifest);
      fs.writeFileSync(path.join(worktree, 'local.txt'), 'tampered\n', 'utf8');
      await assert.rejects(
        validateIgnoredInputs(worktree, provisioned.ignoredInputs, provisioned.ignoredBaseline),
        /preexistente modificado sin autorizaci/,
      );
      fs.writeFileSync(path.join(worktree, 'local.txt'), 'local-base\n', 'utf8');
      fs.rmSync(path.join(worktree, 'local.txt'));
      await assert.rejects(
        validateIgnoredInputs(worktree, provisioned.ignoredInputs, provisioned.ignoredBaseline),
        /preexistente eliminado sin autorizaci/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('la fuente no puede ser el projectRoot ni una ruta que lo escape', async () => {
    const { parent, root } = fixture();
    try {
      writeManifest(root, [{ path: '.env', category: 'ignored-local', source: '.' }]);
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-3', agent: 'agent-a' });
      await assert.rejects(
        startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-3', agent: 'agent-a' }),
        /no puede ser el projectRoot/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('el manifiesto no puede pisar contenido tracked del worktree', async () => {
    const { parent, root } = fixture();
    try {
      writeManifest(root, [{ path: 'base.txt', category: 'ignored-local', source: 'base.txt' }]);
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-4', agent: 'agent-a' });
      await assert.rejects(
        startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-4', agent: 'agent-a' }),
        /no puede pisar contenido tracked/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('una entrada tracked ausente en el worktree se reporta como missing-task-input', async () => {
    const { parent, root } = fixture();
    try {
      writeManifest(root, [{ path: 'ausente.txt', category: 'tracked' }]);
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-5', agent: 'agent-a' });
      await assert.rejects(
        startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-5', agent: 'agent-a' }),
        /missing-task-input: ausente\.txt \(categor/
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('secret no puede declarar source y external/generated no copian nada', async () => {
    const { parent, root } = fixture();
    try {
      writeManifest(root, [
        { path: 'creds.json', category: 'secret', source: 'creds.example' },
      ]);
      await claimTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-6', agent: 'agent-a' });
      await assert.rejects(
        startTask({ projectRoot: root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-6', agent: 'agent-a' }),
        /secret no puede venir de un source/,
      );

      const second = fixture();
      try {
        writeManifest(second.root, [
          { path: 'gen.txt', category: 'generated' },
          { path: 'ext.txt', category: 'external' },
        ]);
        await claimTask({ projectRoot: second.root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-7', agent: 'agent-a' });
        const started = await startTask({ projectRoot: second.root, primaryBranch: PRIMARY_BRANCH, taskId: 'M-7', agent: 'agent-a' });
        assert.strictEqual(fs.existsSync(path.join(started.worktree!, 'gen.txt')), false);
        assert.strictEqual(fs.existsSync(path.join(started.worktree!, 'ext.txt')), false);
      } finally {
        fs.rmSync(second.parent, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
