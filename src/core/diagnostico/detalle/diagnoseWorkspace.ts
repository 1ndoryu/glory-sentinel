/* [028A-6 Fase 1/SNT-16d] Diagnóstico del runtime del gate agnóstico:
 * diagnoseWorkspace, assertWorkspaceReady y policyHashFor. Solo lectura;
 * nunca muta estado. Lo re-exporta diagnose.ts (API pública sin cambios). */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findQualityRoot, hasQualityMarker, resolveGuardRoot, resolveTargetBase } from '../../gate/scheduler';
import { readV2GuardPolicy, GuardPolicy } from '../../guard/guardCommand';
import { runtimeStatus } from '../../runtime-proyecto/runtimeInstall';
import { keyPresent, listLeases } from '../../gate/lease';
import { resolveShimWinners } from '../../shims/shimDiagnostics';
import { avisosDeCobertura, avisosDeRuntime } from './diagnoseAvisos';
import { currentBranch } from './diagnoseGit';
import { diagnoseConfiguredTools } from './diagnoseHerramientas';
import { readJsonFile } from './diagnoseSonda';
import type { DiagnoseIssue, DiagnoseLeases, DiagnoseLock, DiagnosePolicy, DiagnoseResult, DiagnoseScheduler, DiagnoseTool } from './diagnoseTipos';

export function policyHashFor(root: string, policy: GuardPolicy): string | null {
  if (policy.status === 'no-policy') return null;
  try {
    const content = readFileSync(path.join(root, 'sentinel.config.json'), 'utf8');
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

export async function diagnoseWorkspace(workspace: string): Promise<DiagnoseResult> {
  const foundRoot = await findQualityRoot(workspace);
  const root = foundRoot && hasQualityMarker(foundRoot) ? foundRoot : null;
  let policy: DiagnosePolicy = { status: 'no-policy', mode: null, policyPath: null, policyHash: null };
  let guardPolicy: GuardPolicy = { status: 'no-policy' };
  if (root) {
    const discovered = readV2GuardPolicy(root);
    guardPolicy = discovered;
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

  /* Ruta válida porque este módulo está en src/core/diagnostico/detalle (out/ conserva la profundidad). */
  const packagePath = path.resolve(__dirname, '../../../../package.json');
  const packageJson = await readJsonFile(packagePath) as { version?: unknown } | null;
  const runtime = await runtimeStatus();
  const readyForAnalyze = issues.length === 0;
  const readyForGate = readyForAnalyze && root !== null && policy.status === 'policy';
  return {
    workspace,
    root,
    branch: root ? await currentBranch(root) : null,
    sentinelVersion: runtime.activeVersion ?? (packageJson?.version ? String(packageJson.version) : 'unknown'),
    policy,
    lock,
    scheduler,
    leases,
    tools,
    shims: resolveShimWinners(),
    issues,
    avisos: [...avisosDeCobertura(guardPolicy), ...avisosDeRuntime(runtime)],
    ready: readyForAnalyze,
    readyForAnalyze,
    readyForGate,
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
