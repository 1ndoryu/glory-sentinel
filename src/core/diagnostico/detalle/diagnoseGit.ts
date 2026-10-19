/* Consultas Git de solo lectura del diagnóstico: ramas, gitlinks, estado del
 * checkout y refs de release. Un fallo de git devuelve null o lista vacía y
 * nunca lanza: el doctor reporta el problema en vez de caerse. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function command(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: root, timeout: 10_000, windowsHide: true });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function currentBranch(root: string): Promise<string | null> {
  return command(root, ['symbolic-ref', '--short', 'HEAD']);
}

export async function submoduleCommit(root: string, submodulePath: string): Promise<string | null> {
  const output = await command(root, ['ls-tree', 'HEAD', '--', submodulePath]);
  const match = output?.match(/^160000\s+commit\s+([0-9a-f]{40})/u);
  return match?.[1] ?? null;
}

export async function stagedSubmoduleCommit(root: string, submodulePath: string): Promise<string | null> {
  const output = await command(root, ['ls-files', '--stage', '--', submodulePath]);
  const match = output?.match(/^160000\s+([0-9a-f]{40})\s+0\s+/u);
  return match?.[1] ?? null;
}

export async function checkoutCommit(sourcePath: string): Promise<string | null> {
  return command(sourcePath, ['rev-parse', 'HEAD']);
}

export async function checkoutChanges(sourcePath: string): Promise<string[]> {
  try {
    const output = await execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: sourcePath,
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return output.stdout.split(/\r?\n/u)
      .map(line => line.trimEnd())
      .filter(Boolean)
      .map(line => line.slice(3).replace(/^"|"$/gu, '').replace(/\\/g, '/'));
  } catch {
    return ['<git-status-unavailable>'];
  }
}

function refPatternMatches(ref: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return ref.startsWith(pattern.slice(0, -1));
  return ref === pattern;
}

export async function releaseRefs(sourcePath: string, commit: string | null, configuredRefs: string[]): Promise<string[]> {
  if (!sourcePath || !commit) return [];
  const output = await command(sourcePath, ['for-each-ref', '--contains', commit, '--format=%(refname)', 'refs/remotes', 'refs/tags']);
  const allowedRefs = configuredRefs.length > 0 ? configuredRefs : ['refs/remotes/origin/main', 'refs/tags/v*'];
  return output
    ? output.split(/\r?\n/u)
      .filter(Boolean)
      .filter(ref => allowedRefs.some(pattern => refPatternMatches(ref, pattern)))
    : [];
}
