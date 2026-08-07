/* [028A-6 Fase 1/SNT-16d] Diagnóstico del runtime del gate agnóstico para
 * `sentinel doctor`/`status`: política, lock, versiones, herramientas,
 * scheduler y raíz canónica. Solo lectura; nunca muta estado. */
import { createHash } from 'node:crypto';
import { access, readFile, realpath } from 'node:fs/promises';
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
  cliCapabilities: string[];
  missingCapabilities: string[];
  packagePresent: boolean;
  packageLockPresent: boolean;
  dependenciesPresent: boolean;
  requiredScripts: string[];
  missingScripts: string[];
  releaseRefs: string[];
  releaseReachable: boolean;
  releaseEvidencePresent: boolean;
  checkoutDirty: boolean;
  checkoutChanges: string[];
  unexpectedChanges: string[];
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

async function checkoutChanges(sourcePath: string): Promise<string[]> {
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

async function cliCapabilities(cliPath: string | null): Promise<string[]> {
  if (!cliPath) return [];
  try {
    const result = await execFileAsync(process.execPath, [cliPath, '--help'], {
      cwd: path.dirname(cliPath),
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    const text = `${result.stdout}\n${result.stderr}`;
    return ['analyze', 'check', 'guard', 'doctor', 'status', 'task', 'recover']
      .filter(capability => new RegExp(`(?:^|[\\s|])${capability}(?:\\s|$|[<|])`, 'mu').test(text));
  } catch {
    return [];
  }
}

async function packageMetadata(sourcePath: string | null, config: Record<string, unknown> | null): Promise<{
  packagePresent: boolean;
  packageLockPresent: boolean;
  dependenciesPresent: boolean;
  requiredScripts: string[];
  missingScripts: string[];
}> {
  if (!sourcePath) return { packagePresent: false, packageLockPresent: false, dependenciesPresent: false, requiredScripts: [], missingScripts: [] };
  let packageJson: { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> } | null = null;
  try {
    packageJson = JSON.parse(await readFile(path.join(sourcePath, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  } catch {
    return { packagePresent: false, packageLockPresent: false, dependenciesPresent: false, requiredScripts: [], missingScripts: [] };
  }
  const packageLockPresent = await access(path.join(sourcePath, 'package-lock.json')).then(() => true).catch(() => false);
  const declaredDependencies = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
  const dependenciesPresent = await access(path.join(sourcePath, 'node_modules')).then(async () =>
    Promise.all(declaredDependencies.map(async dependency => {
      try { await access(path.join(sourcePath, 'node_modules', dependency)); return true; } catch { return false; }
    })).then(results => results.every(Boolean))
  ).catch(() => false);
  const requiredScripts = [config?.buildScript, config?.testScript]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const missingScripts = requiredScripts.filter(script => typeof packageJson?.scripts?.[script] !== 'string');
  return { packagePresent: true, packageLockPresent, dependenciesPresent, requiredScripts, missingScripts };
}

function refPatternMatches(ref: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return ref.startsWith(pattern.slice(0, -1));
  return ref === pattern;
}

async function releaseRefs(sourcePath: string, commit: string | null, configuredRefs: string[]): Promise<string[]> {
  if (!sourcePath || !commit) return [];
  const output = await command(sourcePath, ['for-each-ref', '--contains', commit, '--format=%(refname)', 'refs/remotes', 'refs/tags']);
  const allowedRefs = configuredRefs.length > 0 ? configuredRefs : ['refs/remotes/origin/main', 'refs/tags/v*'];
  return output
    ? output.split(/\r?\n/u)
      .filter(Boolean)
      .filter(ref => allowedRefs.some(pattern => refPatternMatches(ref, pattern)))
    : [];
}

async function releaseEvidence(root: string, name: string, commit: string | null, configuredTestScript: string | null): Promise<boolean> {
  if (!commit) return false;
  const evidence = await readJsonFile(path.join(root, '.sentinel', 'release-evidence', `${name}.json`));
  return Boolean(evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    && (evidence as Record<string, unknown>).commit === commit
    && (evidence as Record<string, unknown>).compile === 'passed'
    && (evidence as Record<string, unknown>).suite === (configuredTestScript ? 'passed' : 'not-configured')
    && (evidence as Record<string, unknown>).cleanStaging === true);
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
    const configuredSourcePath = resolveSourcePath(root, config);
    const sourceRealPath = configuredSourcePath ? await realpath(configuredSourcePath).catch(() => null) : null;
    const sourceEscapesWorkspace = Boolean(
      configuredSourcePath
      && sourceRealPath
      && insideWorkspace(root, configuredSourcePath)
      && !insideWorkspace(root, sourceRealPath),
    );
    const sourcePath = sourceEscapesWorkspace ? null : configuredSourcePath;
    const sourceExternal = sourceRealPath ? !insideWorkspace(root, sourceRealPath) : Boolean(sourcePath && !insideWorkspace(root, sourcePath));
    const lockEntry = lockAnalyzers[name] && typeof lockAnalyzers[name] === 'object' && !Array.isArray(lockAnalyzers[name])
      ? lockAnalyzers[name] as Record<string, unknown>
      : null;
    const configuredCommit = typeof config?.commit === 'string' ? config.commit : null;
    const configuredVersion = typeof config?.version === 'string' ? config.version : null;
    const lockVersion = typeof lockEntry?.version === 'string' ? lockEntry.version : null;
    const cli = typeof config?.cli === 'string' && sourcePath ? path.resolve(sourcePath, config.cli) : null;
    const cliRealPath = cli ? await realpath(cli).catch(() => null) : null;
    const cliInsideSource = Boolean(
      sourcePath
      && cli
      && (cliRealPath ?? cli)
      && insideWorkspace(sourceRealPath ?? sourcePath, cliRealPath ?? cli),
    );
    let sourcePresent = false;
    let cliPresent = false;
    let actualCommit: string | null = null;
    let dirty = false;
    let changes: string[] = [];
    if (sourcePath) {
      try { await access(sourcePath); sourcePresent = true; } catch { sourcePresent = false; }
      if (sourcePresent) {
        actualCommit = await checkoutCommit(sourcePath);
        changes = actualCommit ? await checkoutChanges(sourcePath) : ['<git-checkout-unavailable>'];
        dirty = changes.length > 0;
      }
      if (cli) {
        try { await access(cli); cliPresent = true; } catch { cliPresent = false; }
      }
    }
    const reportedVersion = await cliVersion(cliPresent ? cli : null);
    const capabilities = await cliCapabilities(cliPresent ? cli : null);
    const metadata = await packageMetadata(sourcePath, config);
    const configuredReleaseRefs = Array.isArray(config?.releaseRefs)
      ? config.releaseRefs.filter((value): value is string => typeof value === 'string')
      : [];
    const publishedRefs = sourcePath && actualCommit ? await releaseRefs(sourcePath, actualCommit, configuredReleaseRefs) : [];
    const releaseEvidencePresent = await releaseEvidence(
      root,
      name,
      actualCommit,
      typeof config?.testScript === 'string' ? config.testScript : null,
    );
    const requiredCapabilities = Array.isArray(config?.requiredCapabilities)
      ? config.requiredCapabilities.filter((value): value is string => typeof value === 'string')
      : (name === 'sentinel' ? ['guard', 'doctor', 'task', 'recover'] : []);
    /* sourcePath interno no admite patch local (setup lo rechaza); cualquier
     * cambio distinto de la metadata administrativa es inesperado. */
    const unexpectedChanges = changes.filter(change => change !== '.quality-install.json');
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
      cliCapabilities: capabilities,
      missingCapabilities: requiredCapabilities.filter(capability => !capabilities.includes(capability)),
      packagePresent: metadata.packagePresent,
      packageLockPresent: metadata.packageLockPresent,
      dependenciesPresent: metadata.dependenciesPresent,
      requiredScripts: metadata.requiredScripts,
      missingScripts: metadata.missingScripts,
      releaseRefs: publishedRefs,
      releaseReachable: publishedRefs.length > 0,
      releaseEvidencePresent,
      checkoutDirty: dirty,
      checkoutChanges: changes,
      unexpectedChanges,
    };
    tools[name] = diagnostic;
    const issue = (code: string, message: string) => issues.push({ code, message, tool: name });
    if (!config) issue('tool-config-invalid', `${name}: configuración ausente o inválida`);
    if (sourceEscapesWorkspace) issue('tool-source-escape', `${name}: sourcePath resuelve mediante symlink/junction fuera del workspace`);
    if (!sourcePath || !sourcePresent) issue('tool-source-missing', `${name}: sourcePath no está inicializado o no existe`);
    if (sourcePresent && !actualCommit) issue('tool-checkout-invalid', `${name}: no es un checkout Git resoluble`);
    if (!cliPresent) issue('tool-cli-missing', `${name}: falta el CLI compilado (${config?.cli ?? 'cli no declarado'})`);
    else if (!reportedVersion) issue('tool-cli-unresponsive', `${name}: el CLI no responde a --version`);
    if (cli && !cliInsideSource) issue('tool-cli-escape', `${name}: el CLI queda fuera del checkout físico de sourcePath`);
    if (sourcePresent && !metadata.packagePresent) issue('tool-package-missing', `${name}: falta package.json`);
    if (sourcePresent && !metadata.packageLockPresent) issue('tool-package-lock-missing', `${name}: falta package-lock.json reproducible`);
    if (sourcePresent && !metadata.dependenciesPresent) issue('tool-dependencies-missing', `${name}: node_modules no está provisionado`);
    for (const script of metadata.missingScripts) issue('tool-script-missing', `${name}: falta el script requerido '${script}' en package.json`);
    for (const capability of diagnostic.missingCapabilities) issue('tool-capability-missing', `${name}: capacidad no instalada: ${capability}`);
    if (sourcePresent && actualCommit && unexpectedChanges.some(change => /(^|\/)package-lock\.json$/u.test(change))) {
      issue('tool-package-lock-dirty', `${name}: package-lock.json modificado; instalación interrumpida o lock no reproducible`);
    }
    if (sourcePresent && actualCommit && dirty && unexpectedChanges.length > 0) issue('tool-checkout-dirty', `${name}: checkout modificado; cambios no declarados: ${unexpectedChanges.join(', ')}`);
    if (sourcePresent && actualCommit && !diagnostic.releaseReachable) issue('tool-release-unpublished', `${name}: commit ${actualCommit} no es alcanzable desde una ref de release permitida`);
    if (sourcePresent && actualCommit && !releaseEvidencePresent) issue('tool-release-evidence-missing', `${name}: falta evidencia compile + suite desde staging limpio para ${actualCommit}; ejecuta npm run quality:setup`);
    if (!configuredCommit) issue('tool-config-commit-missing', `${name}: falta el commit fijado en quality-tools.json`);
    if (!lockEntry) issue('tool-lock-entry-missing', `${name}: falta analyzers.${name} en sentinel.lock.json`);
    if (sourcePresent && relativeSource && !gitlinkCommit) issue('tool-gitlink-missing', `${name}: sourcePath interno no está representado por un gitlink inicializado`);
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
    const capabilityText = tool.missingCapabilities.length > 0 ? ` - capabilities missing: ${tool.missingCapabilities.join(',')}` : '';
    const releaseText = tool.releaseReachable ? ` - release refs: ${tool.releaseRefs.join(',')}${tool.releaseEvidencePresent ? ' - clean evidence ok' : ' - clean evidence missing'}` : ' - release unpublished';
    const dependencyText = tool.dependenciesPresent ? '' : ' - dependencies missing';
    lines.push(`  ${tool.name}: source ${tool.sourcePresent ? 'ok' : 'missing'} - cli ${tool.cliPresent ? 'ok' : 'missing'} - version ${tool.cliVersion ?? 'failed'} - checkout ${tool.checkoutCommit?.slice(0, 8) ?? 'n/a'}${tool.checkoutDirty ? ' - DIRTY' : ''}${dependencyText}${capabilityText}${releaseText}`);
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
