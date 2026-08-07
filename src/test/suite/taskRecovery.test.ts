/* [SNT-16d] Recuperación segura de tareas interrumpidas. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { claimTask, TASK_TTL_MS, taskStatus } from '../../core/taskCoordinator';
import { recoverTask } from '../../core/taskRecovery';

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture(): { parent: string; root: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-recovery-'));
  const root = path.join(parent, 'repo');
  fs.mkdirSync(root);
  git(root, ['init', '-q', '-b', 'wandorius']);
  git(root, ['config', 'user.email', 'sentinel@example.test']);
  git(root, ['config', 'user.name', 'Sentinel Test']);
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, ['add', 'base.txt']);
  git(root, ['commit', '-q', '-m', 'base']);
  return { parent, root };
}

async function setStoppedProcessPid(root: string, taskId: string): Promise<void> {
  const status = await taskStatus(root, 'wandorius');
  const record = status.tasks.find(item => item.taskId === taskId);
  assert.ok(record);
  const metadataPath = path.join(root, '.sentinel', 'coordination');
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.name === `${taskId}.json`) files.push(entryPath);
    }
  };
  walk(metadataPath);
  assert.strictEqual(files.length, 1);
  const value = JSON.parse(fs.readFileSync(files[0], 'utf8')) as { pid: number; host: string };
  value.pid = 2147483647;
  value.host = os.hostname();
  fs.writeFileSync(files[0], `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

suite('task recovery', () => {
  test('rechaza recuperar una tarea no expirada', async () => {
    const { parent, root } = fixture();
    try {
      await claimTask({ projectRoot: root, primaryBranch: 'wandorius', taskId: 'RECOVER-1', agent: 'old-agent' });
      await assert.rejects(
        recoverTask({ projectRoot: root, primaryBranch: 'wandorius', taskId: 'RECOVER-1', recoveredBy: 'new-agent' }),
        /no está expirada/,
      );
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });

  test('permite dry-run solo con toma expirada sin recursos creados', async () => {
    const { parent, root } = fixture();
    try {
      const now = Date.now();
      await claimTask({ projectRoot: root, primaryBranch: 'wandorius', taskId: 'RECOVER-2', agent: 'old-agent', now: now - TASK_TTL_MS - 1 });
      await setStoppedProcessPid(root, 'RECOVER-2');
      const result = await recoverTask({ projectRoot: root, primaryBranch: 'wandorius', taskId: 'RECOVER-2', recoveredBy: 'new-agent', dryRun: true, now });
      assert.strictEqual(result.state, 'DRY_RUN');
      assert.strictEqual(result.previousAgent, 'old-agent');
      assert.strictEqual(result.worktree, null);
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
});
