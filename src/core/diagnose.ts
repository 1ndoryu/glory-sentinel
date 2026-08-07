/* [028A-6 Fase 1/SNT-16d] Diagnóstico del runtime del gate agnóstico para
 * `sentinel doctor`/`status`: política, lock, versiones, herramientas,
 * scheduler y raíz canónica. Solo lectura; nunca muta estado. */
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { findQualityRoot, hasQualityMarker, resolveGuardRoot, resolveTargetBase } from './scheduler';
import { readV2GuardPolicy, GuardPolicy } from './guardCommand';
import { runtimeStatus, RuntimeStatusResult } from './runtimeInstall';
import { keyPresent, listLeases } from './lease';

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

export interface DiagnoseTool {
  name: string;
  /** Kept for consumers of the previous `{ commit }` diagnostic shape. */
  commit: string | null;
  sourcePath: string | null;
  sourceExternal: boolean;
  cliPath: string | null;
  cliVersion: string | null;
  configuredVersion: string | null;
  lockVersion: string | null;
  configuredCommit: string | null;
  gitlinkCommit: string | null;
  checkoutCommit: string | null;
  lockCommit: string | null;
  sourcePresent: boolean;
  cliPresent: boolean;
  cliResponds: boolean;
  checkoutDirty: boolean;
}

export interface DiagnoseIssue {
  code: string;
  message: string;
  tool?: string;
}

export interface DiagnoseScheduler {
  targetBase: string;
  guardRoot: string;
  stateProjects?: number;
  activePid?: unknown;
  activeCommand?: unknown;
}

export interface DiagnoseLeases {
  guardRoot: string;
  keyPresent: boolean;
  active: number;
  expired: number;
}

export interface DiagnoseResult {
  workspace: string;
  root: string | null;
  branch: string | null;
  sentinelVersion: string;
  policy: DiagnosePolicy;
  lock: DiagnoseLock;
  scheduler: DiagnoseScheduler | null;
  leases: DiagnoseLeases | null;
  tools: Record<string, DiagnoseTool>;
  issues: DiagnoseIssue[];
  ready: boolean;
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

async function submoduleCommit(root: string, submodulePath: string): Promise<string | null> {
  const output = await command(root, ['ls-tree', 'HEAD', submodulePath]);
  const match = output?.match(/^160000\s+commit\s+([0-9a-f]{40})/u);
  return match?.[1] ?? null;
}

async function checkoutCommit(sourcePath: string): Promise<string | null> {
  return command(sourcePath, ['rev-parse', 'HEAD']);
}

async function checkoutDirty(sourcePath: string): Promise<boolean> {
  try {
    const output = await execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: sourcePath,
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return output.stdout.trim().length > 0;
  } catch {
    return true;
  }
}

async function cliVersion(cliPath: string | null): Promise<string | null> {
  if (!cliPath) return null;
  try {
    const result = await execFileAsync(process.execPath, [cliPath, '--version'], {
      cwd: path.dirname(cliPath),
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    const value = result.stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function toolConfig(manifest: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const value = manifest[name];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function resolveSourcePath(root: string, config: Record<string, unknown> | null): string | null {
  const sourcePath = config?.sourcePath;
  if (typeof sourcePath === 'string' && sourcePath.length > 0) return path.resolve(root, sourcePath);
  const sourcePathEnv = config?.sourcePathEnv;
  if (typeof sourcePathEnv === 'string' && /^GLORY_[A-Z0-9_]+$/u.test(sourcePathEnv)) {
    const value = process.env[sourcePathEnv];
    return typeof value === 'string' && value.length > 0 ? path.resolve(value) : null;
  }
  return null;
}

function insideWorkspace(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function diagnoseConfiguredTools(root: string, lockData: Record<string, unknown> | null): Promise<{ tools: Record<string, DiagnoseTool>; issues: DiagnoseIssue[] }> {
  const manifest = await readJsonFile(path.join(root, 'quality-tools.json')) as { tools?: unknown } | null;
  if (!manifest || !manifest.tools || typeof manifest.tools !== 'object' || Array.isArray(manifest.tools)) {
    return { tools: {}, issues: [{ code: 'tools-manifest-missing', message: 'quality-tools.json no contiene tools verificables' }] };
  }
  const configuredTools = manifest.tools as Record<string, unknown>;
  const lockAnalyzers = lockData?.analyzers && typeof lockData.analyzers === 'object' && !Array.isArray(lockData.analyzers)
    ? lockData.analyzers as Record<string, unknown>
    : {};
  const tools: Record<string, DiagnoseTool> = {};
  const issues: DiagnoseIssue[] = [];
  for (const name of Object.keys(configuredTools)) {
    const config = toolConfig(configuredTools, name);
    const sourcePath = resolveSourcePath(root, config);
    const sourceExternal = sourcePath ? !insideWorkspace(root, sourcePath) : false;
    const lockEntry = lockAnalyzers[name] && typeof lockAnalyzers[name] === 'object' && !Array.isArray(lockAnalyzers[name])
      ? lockAnalyzers[name] as Record<string, unknown>
      : null;
    const configuredCommit = typeof config?.commit === 'string' ? config.commit : null;
    const configuredVersion = typeof config?.version === 'string' ? config.version : null;
    const lockVersion = typeof lockEntry?.version === 'string' ? lockEntry.version : null;
    const cli = typeof config?.cli === 'string' && sourcePath ? path.resolve(sourcePath, config.cli) : null;
    const cliInsideSource = Boolean(sourcePath && cli && insideWorkspace(sourcePath, cli));
    let sourcePresent = false;
    let cliPresent = false;
    let actualCommit: string | null = null;
    let dirty = false;
    if (sourcePath) {
      try { await access(sourcePath); sourcePresent = true; } catch { sourcePresent = false; }
      if (sourcePresent) {
        actualCommit = await checkoutCommit(sourcePath);
        dirty = actualCommit ? await checkoutDirty(sourcePath) : false;
      }
      if (cli) {
        try { await access(cli); cliPresent = true; } catch { cliPresent = false; }
      }
    }
    const reportedVersion = await cliVersion(cliPresent ? cli : null);
    const relativeSource = sourcePath && insideWorkspace(root, sourcePath)
      ? path.relative(root, sourcePath).replace(/\\/g, '/')
      : null;
    const gitlinkCommit = relativeSource ? await submoduleCommit(root, relativeSource) : null;
    const lockCommit = typeof lockEntry?.commit === 'string' ? lockEntry.commit : null;
    const diagnostic: DiagnoseTool = {
      name,
      commit: actualCommit,
      sourcePath,
      sourceExternal,
      cliPath: cli,
      cliVersion: reportedVersion,
      configuredVersion,
      lockVersion,
      configuredCommit,
      gitlinkCommit,
      checkoutCommit: actualCommit,
      lockCommit,
      sourcePresent,
      cliPresent,
      cliResponds: Boolean(reportedVersion),
      checkoutDirty: dirty,
    };
    tools[name] = diagnostic;
    const issue = (code: string, message: string) => issues.push({ code, message, tool: name });
    if (!config) issue('tool-config-invalid', `${name}: configuración ausente o inválida`);
    if (!sourcePath || !sourcePresent) issue('tool-source-missing', `${name}: sourcePath no está inicializado o no existe`);
    if (sourcePresent && !actualCommit) issue('tool-checkout-invalid', `${name}: no es un checkout Git resoluble`);
    if (!cliPresent) issue('tool-cli-missing', `${name}: falta el CLI compilado (${config?.cli ?? 'cli no declarado'})`);
    else if (!reportedVersion) issue('tool-cli-unresponsive', `${name}: el CLI no responde a --version`);
    if (cli && !cliInsideSource) issue('tool-cli-escape', `${name}: el CLI queda fuera de sourcePath`);
    if (sourcePresent && actualCommit && dirty) issue('tool-checkout-dirty', `${name}: checkout modificado; no se puede confiar en el lock`);
    if (!configuredCommit) issue('tool-config-commit-missing', `${name}: falta el commit fijado en quality-tools.json`);
    if (!lockEntry) issue('tool-lock-entry-missing', `${name}: falta analyzers.${name} en sentinel.lock.json`);
    if (configuredCommit && gitlinkCommit && configuredCommit !== gitlinkCommit) issue('tool-gitlink-mismatch', `${name}: quality-tools.json no coincide con el gitlink`);
    if (configuredCommit && actualCommit && configuredCommit !== actualCommit) issue('tool-checkout-mismatch', `${name}: checkout no coincide con quality-tools.json`);
    if (configuredCommit && configuredCommit !== lockCommit) issue('tool-lock-mismatch', `${name}: sentinel.lock.json no coincide con quality-tools.json`);
    if (configuredVersion && configuredVersion !== lockVersion) issue('tool-lock-version-mismatch', `${name}: sentinel.lock.json version does not match quality-tools.json`);
    if (configuredVersion && reportedVersion && configuredVersion !== reportedVersion) issue('tool-version-mismatch', `${name}: CLI reporta ${reportedVersion}, se esperaba ${configuredVersion}`);
    if (actualCommit && actualCommit !== lockCommit) issue('tool-installed-mismatch', `${name}: checkout instalado no coincide con sentinel.lock.json`);
  }
  return { tools, issues };
}

export async function diagnoseWorkspace(workspace: string): Promise<DiagnoseResult> {
  const foundRoot = await findQualityRoot(workspace);
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

  const lockData = root ? await readJsonFile(path.join(root, 'sentinel.lock.json')) as Record<string, unknown> | null : null;
  const lockAnalyzers = lockData?.analyzers && typeof lockData.analyzers === 'object' && !Array.isArray(lockData.analyzers)
    ? lockData.analyzers as Record<string, unknown> : null;
  const sentinelLock = lockAnalyzers?.sentinel && typeof lockAnalyzers.sentinel === 'object' && !Array.isArray(lockAnalyzers.sentinel)
    ? lockAnalyzers.sentinel as Record<string, unknown> : null;
  const lock: DiagnoseLock = root && lockData
    ? { present: true, version: typeof sentinelLock?.version === 'string' ? sentinelLock.version : null, commit: typeof sentinelLock?.commit === 'string' ? sentinelLock.commit : null, path: path.join(root, 'sentinel.lock.json') }
    : { present: false, version: null, commit: null, path: root ? path.join(root, 'sentinel.lock.json') : null };

  const targetBase = resolveTargetBase();
  const guardRoot = resolveGuardRoot(targetBase);
  const tools: Record<string, DiagnoseTool> = {};
  let issues: DiagnoseIssue[] = [];
  if (root) {
    const toolDiagnostics = await diagnoseConfiguredTools(root, lockData);
    Object.assign(tools, toolDiagnostics.tools);
    issues = toolDiagnostics.issues;
    if (!lockData) issues.unshift({ code: 'lock-missing', message: 'sentinel.lock.json no existe o no es JSON válido' });
    if (lockData && !sentinelLock) issues.unshift({ code: 'lock-sentinel-missing', message: 'sentinel.lock.json no contiene analyzers.sentinel verificable' });
  }

  const state = await readJsonFile(path.join(guardRoot, 'state.json')) as { projects?: unknown } | null;
  const active = await readJsonFile(path.join(guardRoot, 'active.json')) as { pid?: unknown; command?: unknown } | null;
  const scheduler: DiagnoseScheduler = {
    targetBase,
    guardRoot,
    ...(state ? { stateProjects: Object.keys(state.projects ?? {}).length } : {}),
    ...(active ? { activePid: active.pid, activeCommand: active.command } : {}),
  };

  let leases: DiagnoseLeases | null = null;
  try {
    const all = await listLeases(guardRoot);
    leases = { guardRoot, keyPresent: keyPresent(guardRoot), active: all.filter(lease => !lease.expired).length, expired: all.filter(lease => lease.expired).length };
  } catch { leases = null; }

  const packagePath = path.resolve(__dirname, '../../package.json');
  const packageJson = await readJsonFile(packagePath) as { version?: unknown } | null;
  const runtime = await runtimeStatus();
  return {
    workspace,
    root,
    branch: root ? await currentBranch(root) : null,
    sentinelVersion: packageJson?.version ? String(packageJson.version) : 'unknown',
    policy,
    lock,
    scheduler,
    leases,
    tools,
    issues,
    ready: issues.length === 0,
    runtime,
  };
}

export async function assertWorkspaceReady(workspace: string): Promise<DiagnoseResult> {
  const result = await diagnoseWorkspace(workspace);
  if (!result.ready) {
    const details = result.issues.map(issue => `${issue.code}: ${issue.message}`).join('; ');
    throw new Error(`preflight Sentinel bloqueado: ${details}`);
  }
  return result;
}

export function formatDiagnose(result: DiagnoseResult): string {
  const lines = [
    `Sentinel ${result.sentinelVersion}`,
    `Workspace: ${result.workspace}`,
    `Raíz del gate: ${result.root ?? 'no encontrada'}`,
    `Rama: ${result.branch ?? 'n/a'}`,
    `Política: ${result.policy.status}${result.policy.mode ? ` · modo ${result.policy.mode}` : ''}${result.policy.policyHash ? ` · hash ${result.policy.policyHash.slice(0, 12)}` : ''}`,
    `Lock: ${result.lock.present ? `presente (${result.lock.version ?? '?'} · ${result.lock.commit?.slice(0, 8) ?? '?'})` : 'ausente'}`,
    `Preflight: ${result.ready ? 'PASS' : `BLOQUEADO (${result.issues.length} problemas)`}`,
    `Scheduler: ${result.scheduler ? `target ${result.scheduler.targetBase}${result.scheduler.stateProjects !== undefined ? ` · ${result.scheduler.stateProjects} proyectos` : ''}${result.scheduler.activePid !== undefined ? ` · activo PID ${String(result.scheduler.activePid)}` : ''}` : 'no disponible'}`,
    `Leases: ${result.leases ? `clave ${result.leases.keyPresent ? 'ok' : 'ausente'} · ${result.leases.active} activas · ${result.leases.expired} expiradas` : 'no disponible'}`,
    `Runtime: ${result.runtime.activeVersion ? `activa v${result.runtime.activeVersion} (${result.runtime.activeVerified ? 'hash verificado' : 'hash pendiente'})` : 'no instalado'} · ${result.runtime.versions.length} versiones en ${result.runtime.targetRoot}`,
  ];
  for (const tool of Object.values(result.tools)) {
    lines.push(`  ${tool.name}: source ${tool.sourcePresent ? 'ok' : 'missing'} - cli ${tool.cliPresent ? 'ok' : 'missing'} - version ${tool.cliVersion ?? 'failed'} - checkout ${tool.checkoutCommit?.slice(0, 8) ?? 'n/a'}${tool.checkoutDirty ? ' - DIRTY' : ''}`);
  }
  for (const issue of result.issues) lines.push(`ERROR ${issue.code}: ${issue.message}`);
  return lines.join('\n');
}

export function formatStatus(result: DiagnoseResult): string {
  const policy = result.policy.status === 'policy' ? `enforce:${result.policy.mode}` : result.policy.status;
  const lock = result.lock.present ? (result.lock.commit?.slice(0, 8) ?? 'locked') : 'no-lock';
  const runtime = result.runtime.activeVersion ? `runtime v${result.runtime.activeVersion}` : 'runtime none';
  return `sentinel ${result.sentinelVersion} · ${policy} · lock ${lock} · preflight ${result.ready ? 'pass' : 'blocked'} · root ${result.root ?? 'none'} · ${runtime}`;
}
