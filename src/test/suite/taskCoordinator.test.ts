import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
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

function fixture(): { parent: string; root: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-task-'));
  const root = path.join(parent, 'repo');
  fs.mkdirSync(root);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'sentinel@example.test']);
  git(root, ['config', 'user.name', 'Sentinel Test']);
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n', 'utf8');
  git(root, ['add', 'base.txt']);
  git(root, ['commit', '-q', '-m', 'base']);
  return { parent, root };
}

suite('task coordinator', () => {
  test('solo un agente gana dos claims concurrentes para la misma tarea', async () => {
    const { parent, root } = fixture();
    try {
      const results = await Promise.allSettled([
        claimTask({ projectRoot: root, taskId: 'T-1', agent: 'agent-a' }),
        claimTask({ projectRoot: root, taskId: 'T-1', agent: 'agent-b' }),
      ]);
      assert.strictEqual(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.strictEqual(results.filter(result => result.status === 'rejected').length, 1);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('rechaza takeover silencioso y exige force cuando la toma expiró', async () => {
    const { parent, root } = fixture();
    try {
      const now = Date.now();
      await claimTask({ projectRoot: root, taskId: 'T-2', agent: 'agent-a', now: now - TASK_TTL_MS - 1 });
      await assert.rejects(
        claimTask({ projectRoot: root, taskId: 'T-2', agent: 'agent-b', now }),
        /force\/takeover explícito/,
      );
      const taken = await claimTask({ projectRoot: root, taskId: 'T-2', agent: 'agent-b', now, force: true });
      assert.strictEqual(taken.agent, 'agent-b');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('start crea rama y worktree sin ensuciar el checkout principal', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, taskId: 'T-3', agent: 'agent-a' });
      const task = await startTask({ projectRoot: root, taskId: 'T-3', agent: 'agent-a' });
      assert.strictEqual(git(root, ['status', '--porcelain']), '');
      assert.strictEqual(git(root, ['branch', '--show-current']), 'main');
      assert.strictEqual(git(task.worktree!, ['branch', '--show-current']), 'task/T-3');
      assert.strictEqual(fs.existsSync(task.worktree!), true);
      await assert.rejects(startTask({ projectRoot: root, taskId: 'T-3', agent: 'agent-a' }), /estado ACTIVE/);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('integra solo un commit limpio con base estable y limpia repetidamente', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, taskId: 'T-4', agent: 'agent-a' });
      const task = await startTask({ projectRoot: root, taskId: 'T-4', agent: 'agent-a' });
      fs.writeFileSync(path.join(task.worktree!, 'feature.txt'), 'feature\n', 'utf8');
      git(task.worktree!, ['add', 'feature.txt']);
      git(task.worktree!, ['commit', '-q', '-m', 'T-4: feature']);
      const integrated = await integrateTask({ projectRoot: root, taskId: 'T-4', agent: 'agent-a' });
      assert.strictEqual(integrated.state, 'INTEGRATED');
      assert.strictEqual(fs.existsSync(path.join(root, 'feature.txt')), true);
      await cleanupTask({ projectRoot: root, taskId: 'T-4', agent: 'agent-a' });
      await cleanupTask({ projectRoot: root, taskId: 'T-4', agent: 'agent-a' });
      const status = await taskStatus(root);
      assert.strictEqual(status.tasks.length, 0);
      assert.strictEqual(status.orphanWorktrees.length, 0);
      assert.strictEqual(git(root, ['branch', '--list', 'task/T-4']), '');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('rechaza gate en el checkout principal y conserva el heartbeat activo', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, taskId: 'T-6', agent: 'agent-a' });
      const task = await startTask({ projectRoot: root, taskId: 'T-6', agent: 'agent-a' });
      await assert.rejects(
        verifyTaskWorktree({ projectRoot: root, taskId: 'T-6', agent: 'agent-a' }),
        /no coincide con el worktree/,
      );
      const heartbeat = await heartbeatTask({ projectRoot: root, taskId: 'T-6', agent: 'agent-a' });
      assert.strictEqual(heartbeat.state, 'ACTIVE');
      assert.ok(task.worktree);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('rechaza integrar una tarea expirada sin takeover explícito', async () => {
    const { parent, root } = fixture();
    try {
      const now = Date.now();
      await claimTask({ projectRoot: root, taskId: 'T-7', agent: 'agent-a', now: now - TASK_TTL_MS - 1 });
      const task = await startTask({ projectRoot: root, taskId: 'T-7', agent: 'agent-a', now: now - TASK_TTL_MS - 1 });
      fs.writeFileSync(path.join(task.worktree!, 'feature.txt'), 'feature\n', 'utf8');
      git(task.worktree!, ['add', 'feature.txt']);
      git(task.worktree!, ['commit', '-q', '-m', 'T-7: feature']);
      await assert.rejects(
        integrateTask({ projectRoot: root, taskId: 'T-7', agent: 'agent-a', now }),
        /toma expirada/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('bloquea integración con target sucio y release cruzado', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, taskId: 'T-5', agent: 'agent-a' });
      await startTask({ projectRoot: root, taskId: 'T-5', agent: 'agent-a' });
      fs.writeFileSync(path.join(root, 'uncommitted.txt'), 'dirty\n', 'utf8');
      await assert.rejects(
        integrateTask({ projectRoot: root, taskId: 'T-5', agent: 'agent-a' }),
        /target sucio/,
      );
      await assert.rejects(
        releaseTask({ projectRoot: root, taskId: 'T-5', agent: 'agent-b' }),
        /pertenece a agent-a/,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
