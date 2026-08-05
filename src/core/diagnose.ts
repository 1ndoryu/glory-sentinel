/* [028A-6 Fase 1] Diagnóstico del runtime del gate agnóstico para
 * `sentinel doctor`/`status`: política descubierta, lock, versiones, estado
 * del scheduler y raíz canónica. Solo lectura; nunca muta estado. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { findQualityRoot, hasQualityMarker, resolveGuardRoot, resolveTargetBase } from './scheduler';
import { readV2GuardPolicy, GuardPolicy } from './guardCommand';
import { runtimeStatus, RuntimeStatusResult } from './runtimeInstall';

const execFileAsync = promisify(execFile);

export interface DiagnosePolicy {
  status: string;
  mode: string | null;
  policyPath: string | null;
  policyHash: string | null;
}

export interface DiagnoseLock {
  present: boolean;
  version: string | null;
  commit: string | null;
  path: string | null;
}

export interface DiagnoseScheduler {
  targetBase: string;
  guardRoot: string;
  stateProjects?: number;
  activePid?: unknown;
  activeCommand?: unknown;
}

export interface DiagnoseResult {
  workspace: string;
  root: string | null;
  branch: string | null;
  sentinelVersion: string;
  policy: DiagnosePolicy;
  lock: DiagnoseLock;
  scheduler: DiagnoseScheduler | null;
  tools: Record<string, { commit: string | null }>;
  runtime: RuntimeStatusResult;
}

export function policyHashFor(root: string, policy: GuardPolicy): string | null {
  if (policy.status === 'no-policy') return null;
  try {
    const content = readFileSync(path.join(root, 'sentinel.config.json'), 'utf8');
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function currentBranch(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: root,
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function submoduleCommit(root: string, submodulePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-tree', 'HEAD', submodulePath], {
      cwd: root,
      timeout: 10_000,
      windowsHide: true,
    });
    const match = stdout.match(/^160000\s+commit\s+([0-9a-f]{40})/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function diagnoseWorkspace(workspace: string): Promise<DiagnoseResult> {
  const foundRoot = await findQualityRoot(workspace);
  /* [028A-6] findQualityRoot devuelve el startPath como fallback; solo se
   * reporta raíz real cuando existe un marcador declarativo. */
  const root = foundRoot && hasQualityMarker(foundRoot) ? foundRoot : null;
  let policy: DiagnosePolicy = { status: 'no-policy', mode: null, policyPath: null, policyHash: null };
  if (root) {
    const discovered = readV2GuardPolicy(root);
    policy = {
      status: discovered.status,
      mode: discovered.mode ?? null,
      policyPath: discovered.status === 'no-policy' ? null : path.join(root, 'sentinel.config.json'),
      policyHash: policyHashFor(root, discovered),
    };
  }

  const lockData = root
    ? await readJsonFile(path.join(root, 'sentinel.lock.json')) as { analyzers?: { sentinel?: { version?: unknown; commit?: unknown } } } | null
    : null;
  const lock: DiagnoseLock = root && lockData
    ? {
      present: true,
      version: lockData.analyzers?.sentinel?.version ? String(lockData.analyzers.sentinel.version) : null,
      commit: lockData.analyzers?.sentinel?.commit ? String(lockData.analyzers.sentinel.commit) : null,
      path: path.join(root, 'sentinel.lock.json'),
    }
    : { present: false, version: null, commit: null, path: root ? path.join(root, 'sentinel.lock.json') : null };

  const targetBase = resolveTargetBase();
  const guardRoot = resolveGuardRoot(targetBase);
  const tools: Record<string, { commit: string | null }> = {};
  if (root) {
    for (const name of ['tools/sentinel', 'tools/varsense', 'glory-rs']) {
      const commit = await submoduleCommit(root, name);
      if (commit) tools[name] = { commit };
    }
  }
  let scheduler: DiagnoseScheduler | null = null;
  const state = await readJsonFile(path.join(guardRoot, 'state.json')) as { projects?: unknown } | null;
  const active = await readJsonFile(path.join(guardRoot, 'active.json')) as { pid?: unknown; command?: unknown } | null;
  scheduler = {
    targetBase,
    guardRoot,
    ...(state ? { stateProjects: Object.keys(state.projects ?? {}).length } : {}),
    ...(active ? { activePid: active.pid, activeCommand: active.command } : {}),
  };

  const packagePath = path.resolve(__dirname, '../../package.json');
  const packageJson = await readJsonFile(packagePath) as { version?: unknown } | null;
  /* [028A-6] Estado del runtime global (contrato de actualización §3.7):
   * doctor verifica versiones, alias activo y hash del artefacto. */
  const runtime = await runtimeStatus();

  return {
    workspace,
    root,
    branch: root ? await currentBranch(root) : null,
    sentinelVersion: packageJson?.version ? String(packageJson.version) : 'unknown',
    policy,
    lock,
    scheduler,
    tools,
    runtime,
  };
}

export function formatDiagnose(result: DiagnoseResult): string {
  const lines = [
    `Sentinel ${result.sentinelVersion}`,
    `Workspace: ${result.workspace}`,
    `Raíz del gate: ${result.root ?? 'no encontrada'}`,
    `Rama: ${result.branch ?? 'n/a'}`,
    `Política: ${result.policy.status}${result.policy.mode ? ` · modo ${result.policy.mode}` : ''}${result.policy.policyHash ? ` · hash ${result.policy.policyHash.slice(0, 12)}` : ''}`,
    `Lock: ${result.lock.present ? `presente (${result.lock.version ?? '?'} · ${result.lock.commit?.slice(0, 8) ?? '?'})` : 'ausente'}`,
    `Scheduler: ${result.scheduler ? `target ${result.scheduler.targetBase}${result.scheduler.stateProjects !== undefined ? ` · ${result.scheduler.stateProjects} proyectos` : ''}${result.scheduler.activePid !== undefined ? ` · activo PID ${String(result.scheduler.activePid)}` : ''}` : 'no disponible'}`,
    `Runtime: ${result.runtime.activeVersion ? `activa v${result.runtime.activeVersion} (${result.runtime.activeVerified ? 'hash verificado' : 'hash pendiente'})` : 'no instalado'} · ${result.runtime.versions.length} versiones en ${result.runtime.targetRoot}`,
  ];
  for (const [name, tool] of Object.entries(result.tools)) {
    lines.push(`  ${name}: ${tool.commit?.slice(0, 8) ?? 'sin pin'}`);
  }
  return lines.join('\n');
}

export function formatStatus(result: DiagnoseResult): string {
  const policy = result.policy.status === 'policy' ? `enforce:${result.policy.mode}` : result.policy.status;
  const lock = result.lock.present ? (result.lock.commit?.slice(0, 8) ?? 'locked') : 'no-lock';
  const runtime = result.runtime.activeVersion ? `runtime v${result.runtime.activeVersion}` : 'runtime none';
  return `sentinel ${result.sentinelVersion} · ${policy} · lock ${lock} · root ${result.root ?? 'none'} · ${runtime}`;
}
