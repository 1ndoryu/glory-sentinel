import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { canonicalPath, isStrictlyInside } from '../../seguridad-rutas/pathSafety';
import { assertSafeBranch } from '../branchValidation';
import { SAFE_LOCK_KEY, sanitizeTaskId } from './taskCoordinatorValidacion';
import { GIT_MAX_BUFFER, GIT_TIMEOUT_MS } from '../../../utils/gitLimites';

const execFileAsync = promisify(execFile);

export function rootOf(value: string): string { return path.resolve(value); }

export async function git(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: GIT_MAX_BUFFER,
    timeout: GIT_TIMEOUT_MS,
  });
  return result.stdout.trim();
}

export async function gitStatus(root: string): Promise<string> {
  /* `.sentinel/` is Sentinel-owned runtime state. It must not make a clean
   * consumer checkout look dirty, even when the consumer has no .gitignore. */
  const output = await git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  return output.split(/\r?\n/u)
    .filter(line => {
      const file = line.slice(3).replace(/^"|"$/gu, '');
      return file !== '.sentinel' && !file.startsWith('.sentinel/');
    })
    .join('\n');
}

export async function gitCommonDir(root: string): Promise<string> {
  return path.resolve(root, await git(root, ['rev-parse', '--git-common-dir']));
}

async function gitTopLevel(root: string): Promise<string> {
  return path.resolve(root, await git(root, ['rev-parse', '--show-toplevel']));
}

async function repositoryRoot(root: string, commonDir: string): Promise<string> {
  /* A linked worktree reports its own top level, while --git-common-dir still
   * points at the main repository's .git. Prefer that common root when it is
   * available; submodules keep their own top-level fallback. Un worktree
   * externo autorizado (raíz visible del workspace) vive como hermano de la
   * raíz Git, así que su top level NO está dentro de ella: se acepta porque
   * la identidad y la metadata siguen ancladas al common dir del repositorio. */
  const topLevel = await gitTopLevel(root);
  const commonRoot = path.basename(commonDir).toLowerCase() === '.git'
    ? path.dirname(commonDir)
    : topLevel;
  const canonicalRoot = await canonicalPath(commonRoot);
  /* Worktree vinculado (interno o externo): su top level puede estar fuera de
   * la raíz común; la autoridad del proyecto sigue siendo la raíz común. */
  return canonicalRoot;
}

export function projectIdentity(commonDir: string, primaryBranch: string): string {
  return crypto.createHash('sha256')
    .update(`${commonDir}\0${assertSafeBranch(primaryBranch)}`)
    .digest('hex')
    .slice(0, 16);
}

export function taskBranchPrefix(identity: string): string {
  return `task/${identity}`;
}

export async function coordinatorDir(root: string, primaryBranch: string): Promise<string> {
  const commonDir = await gitCommonDir(root);
  const repositoryRootPath = await repositoryRoot(root, commonDir);
  return path.join(repositoryRootPath, '.sentinel', 'coordination', projectIdentity(commonDir, primaryBranch));
}

export async function taskFilePath(root: string, taskId: string, primaryBranch: string): Promise<string> {
  return path.join(await coordinatorDir(root, primaryBranch), `${sanitizeTaskId(taskId)}.json`);
}

export async function lockPath(root: string, key: string, primaryBranch: string): Promise<string> {
  if (!SAFE_LOCK_KEY.test(key)) throw new Error(`clave de lock inválida: ${key}`);
  return path.join(await coordinatorDir(root, primaryBranch), `${key}.lock`);
}

export function branchFor(taskId: string, identity: string): string {
  return `${taskBranchPrefix(identity)}/${sanitizeTaskId(taskId)}`;
}

const INTERNAL_WORKTREE_ROOT = '.sentinel/worktrees';

function defaultWorktree(repositoryRootPath: string, taskId: string, identity: string): string {
  return path.join(
    repositoryRootPath,
    INTERNAL_WORKTREE_ROOT,
    `${path.basename(repositoryRootPath)}-${identity}-${sanitizeTaskId(taskId)}`,
  );
}

export async function resolveWorktreePath(
  root: string,
  requestedPath: string | undefined,
  commonDir: string,
  taskId: string,
  identity: string,
  worktreesRoot?: string,
): Promise<{ worktree: string; worktreesRoot: string }> {
  const repositoryRootPath = await repositoryRoot(root, commonDir);
  const internalRoot = path.join(repositoryRootPath, INTERNAL_WORKTREE_ROOT);
  const defaultWorktreePath = defaultWorktree(repositoryRootPath, taskId, identity);

  /* [VISIBLE-WORKTREE] Raíz autorizada por el consumidor (por ejemplo una
   * carpeta visible del workspace del agente). Solo se acepta una raíz externa
   * declarada explícitamente; una ruta arbitraria sigue bloqueada. La raíz
   * externa debe existir (canonicalPath la resuelve) y quedar fuera del
   * repositorio; el path real se rechaza si es symlink/junction de escape. */
  let authorizedRoot = internalRoot;
  if (worktreesRoot) {
    const canonicalExternal = await canonicalPath(path.resolve(worktreesRoot));
    if (canonicalExternal === repositoryRootPath || isStrictlyInside(canonicalExternal, repositoryRootPath)) {
      throw new Error(`la raíz de worktrees ${worktreesRoot} no puede ser el repositorio ni una subcarpeta de él`);
    }
    authorizedRoot = canonicalExternal;
  }

  const canonicalAuthorizedRoot = await canonicalPath(authorizedRoot);
  if (!worktreesRoot && !isStrictlyInside(canonicalAuthorizedRoot, repositoryRootPath)) {
    throw new Error(`la raíz de worktrees ${internalRoot} debe permanecer dentro del repositorio`);
  }

  const requested = requestedPath
    ? path.resolve(root, requestedPath)
    : worktreesRoot
      ? path.join(authorizedRoot, `${path.basename(repositoryRootPath)}-${identity}-${sanitizeTaskId(taskId)}`)
      : defaultWorktreePath;
  const canonicalRequested = await canonicalPath(requested);
  if (!isStrictlyInside(canonicalRequested, canonicalAuthorizedRoot)) {
    throw new Error(`el worktree debe estar dentro de ${authorizedRoot}; no se permiten rutas externas`);
  }
  return { worktree: requested, worktreesRoot: authorizedRoot };
}

export async function exists(target: string): Promise<boolean> {
  try { await fs.lstat(target); return true; } catch { return false; }
}

export async function branchExists(root: string, branch: string): Promise<boolean> {
  try { await git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]); return true; } catch { return false; }
}

export async function registeredWorktreeFor(root: string, expectedPath: string): Promise<string | null> {
  const output = await git(root, ['worktree', 'list', '--porcelain']);
  let worktree: string | null = null;
  let branch: string | null = null;
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith('worktree ')) {
      worktree = line.slice('worktree '.length);
      branch = null;
    } else if (line.startsWith('branch refs/heads/')) {
      branch = line.slice('branch refs/heads/'.length);
    } else if (!line && worktree) {
      if (path.resolve(worktree) === path.resolve(expectedPath)) return branch;
      worktree = null;
    }
  }
  if (worktree && path.resolve(worktree) === path.resolve(expectedPath)) return branch;
  return null;
}
