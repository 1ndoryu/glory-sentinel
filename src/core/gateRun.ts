/* [028A-6 Fase 1] Orquestación del gate agnóstico para `sentinel check`:
 * alcance → guard (full diferido) → caché de etapas → runner acotado →
 * contrato estructurado → reporte combinado. Extraído del CLI para mantener
 * la capa de comandos delgada y la lógica testeable sin wiring. */
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectScope } from './scope';
import { findQualityRoot, inspectHeavyRun } from './scheduler';
import { readV2GuardPolicy } from './guardCommand';
import { assertWorkspaceReady, currentBranch, policyHashFor } from './diagnose';
import { runBoundedStages } from './stageRunner';
import { fingerprint, readCachedPass, writeCachedPass, StageCacheContext } from './stageCache';
import { runStructuredTool, ToolOutcome } from './structuredTool';
import { loadStageManifest } from './stageManifest';
import { ensureContainedDirectory } from './pathContainment';
import { createReport, compactLines, GateStage } from './gateReport';
import { issueLease, revokeLease, LEASE_ENV_VAR } from './lease';
import type { IssuedLease } from './lease';

const execFileAsync = promisify(execFile);

export interface CheckRunArgs {
  workspace: string;
  reportRoot: string;
  dryRun: boolean;
  taskId?: string;
  full?: boolean;
  ci?: boolean;
  allowHeavy?: boolean;
  profile?: string;
  stagesPath?: string;
}

export interface CheckRunResult {
  exitCode: number;
  output: string;
}

async function readOptionalJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function gitBranch(workspace: string): Promise<{ name?: string } | null> {
  try {
    const { stdout } = await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: workspace,
      timeout: 10_000,
      windowsHide: true,
    });
    const name = stdout.trim();
    return name ? { name } : null;
  } catch {
    return null;
  }
}

async function loadScopeQualityConfig(workspace: string): Promise<{ fullPatterns: string[]; profiles: Record<string, string[]> }> {
  /* [028A-6] Fuente de transición: quality.config.json aporta fullPatterns y
   * perfiles como datos. La fuente canónica del core será la política v2
   * (sentinel.config.json) cuando la consuma. */
  try {
    const raw = JSON.parse(await fs.readFile(path.join(workspace, 'quality.config.json'), 'utf8')) as Partial<{
      fullPatterns?: unknown;
      profiles?: unknown;
    }>;
    return {
      fullPatterns: Array.isArray(raw.fullPatterns) ? (raw.fullPatterns as string[]) : [],
      profiles: raw.profiles && typeof raw.profiles === 'object' ? (raw.profiles as Record<string, string[]>) : {},
    };
  } catch {
    return { fullPatterns: [], profiles: {} };
  }
}

async function reportLimits(workspace: string): Promise<{ maxFindings?: number; maxReminders?: number }> {
  const config = await readOptionalJson(path.join(workspace, 'quality.config.json')) as { maxFindings?: unknown; maxReminders?: unknown } | null;
  return {
    maxFindings: Number.isFinite(Number(config?.maxFindings)) ? Number(config?.maxFindings) : undefined,
    maxReminders: Number.isFinite(Number(config?.maxReminders)) ? Number(config?.maxReminders) : undefined,
  };
}

export async function runCheck(args: CheckRunArgs): Promise<CheckRunResult> {
  const workspace = path.resolve(args.workspace);
  if (!args.dryRun) await assertWorkspaceReady(workspace);
  const reportRoot = await ensureContainedDirectory(workspace, args.reportRoot, 'reportRoot');
  /* [028A-6 Fase 2] Lease efímero firmado por ejecución: exime a las etapas
   * del guard de comandos directos sin depender del token plano (firma +
   * binding de proyecto/PID + expiración + auditoría). La emisión es
   * best-effort: si el runtime no puede emitir, el gate continúa con el
   * token legacy y los shims nuevos no eximen (el guard bloquea, nunca
   * degrada a permisivo). El lease se revoca SIEMPRE al cerrar, aunque el
   * gate falle. */
  const previousGateToken = process.env.GLORY_QUALITY_GATE_TOKEN;
  const previousLeaseEnv = process.env[LEASE_ENV_VAR];
  process.env.GLORY_QUALITY_GATE_TOKEN ||= globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let issuedLease: IssuedLease | null = null;
  try {
    try {
      const leaseRoot = await findQualityRoot(workspace);
      issuedLease = await issueLease({
        projectRoot: leaseRoot,
        taskId: args.taskId ?? null,
        command: 'gate',
      });
      process.env[LEASE_ENV_VAR] = issuedLease.path;
    } catch (error) {
      /* Sin lease: el token legacy cubre las etapas, pero el operador debe
       * saber que los shims nuevos no eximirán (el guard bloquea, nunca
       * degrada a permisivo). */
      process.stderr.write(`[glory-sentinel] aviso: no se pudo emitir el lease del gate (${error instanceof Error ? error.message : String(error)}); las etapas corren con el token legacy.\n`);
    }
    const requestedFull = args.full ?? false;
    const requestedCi = args.ci ?? false;
    return await runCheckWithToken(args, workspace, reportRoot, requestedFull, requestedCi);
  } finally {
    if (issuedLease) await revokeLease({ leasePath: issuedLease.path }).catch(() => {});
    if (previousLeaseEnv === undefined) delete process.env[LEASE_ENV_VAR];
    else process.env[LEASE_ENV_VAR] = previousLeaseEnv;
    if (previousGateToken === undefined) delete process.env.GLORY_QUALITY_GATE_TOKEN;
    else process.env.GLORY_QUALITY_GATE_TOKEN = previousGateToken;
  }
}

async function runCheckWithToken(
  args: CheckRunArgs,
  workspace: string,
  reportRoot: string,
  requestedFull: boolean,
  requestedCi: boolean,
): Promise<CheckRunResult> {
  /* [028A-6] El scheduler decide el full diferido: si el guard está en
   * cooldown (y no hay override), el alcance efectivo es local-light y el
   * motivo llega al manifest como heavy-deferred, igual que el orquestador. */
  const guardDecision = requestedFull || requestedCi
    ? await inspectHeavyRun({
        projectRoot: workspace,
        mode: requestedCi ? 'ci' : 'full',
        allowHeavy: args.allowHeavy ?? false,
      })
    : null;
  const heavyGuard = guardDecision && !guardDecision.allowed
    ? { reason: guardDecision.reason ?? 'guard', nextAllowedAt: guardDecision.nextAllowedAt ?? null }
    : null;
  const qualityConfig = await loadScopeQualityConfig(workspace);
  const scope = await detectScope(
    { projectRoot: workspace, reportRoot, qualityConfig },
    {
      full: requestedFull,
      ci: requestedCi,
      heavyDeferred: heavyGuard,
      profiles: args.profile ? args.profile.split(',').map(item => item.trim()).filter(Boolean) : [],
    },
  );

  if (args.dryRun) {
    return {
      exitCode: 0,
      output: `${JSON.stringify({ ...scope, profiles: [...scope.profiles], taskId: args.taskId ?? null, heavyGuard }, null, 2)}\n`,
    };
  }
  if (!args.stagesPath) {
    throw new Error('check sin --dry-run requiere --stages <json> con las etapas declarativas');
  }

  /* [028A-6] Ejecución real del gate agnóstico: alcance → caché → etapas →
   * reporte combinado. La partición por branch-key del orquestador sigue
   * pendiente del runtime global (aquí: .quality-reports/check/<task-id>). */
  const startedAt = Date.now();
  const declarations = (await loadStageManifest(args.stagesPath, workspace, reportRoot)).stages;
  /* [028A-6] Identidad de caché: la política se hashea del sentinel.config.json
   * del workspace; si la raíz de política real es un ancestro, la identidad
   * difiere (edge case documentado, no cruzado con el orquestador). */
  const cacheContext: StageCacheContext = {
    projectRoot: workspace,
    cacheRoot: path.join(reportRoot, 'cache'),
    ci: requestedCi,
    full: scope.effectiveFull,
    qualityConfig,
    toolManifest: await readOptionalJson(path.join(workspace, 'quality-tools.json')),
    policy: { policyHash: policyHashFor(workspace, readV2GuardPolicy(workspace)) ?? undefined },
    lock: await readOptionalJson(path.join(workspace, 'sentinel.lock.json')),
  };
  const limits = await reportLimits(workspace);
  const logsRoot = path.join(reportRoot, 'logs');
  await fs.mkdir(logsRoot, { recursive: true });
  const outcomes = (await runBoundedStages(declarations, async declaration => {
    const stageFingerprint = await fingerprint(cacheContext, scope, declaration.name);
    const cached = await readCachedPass(cacheContext, declaration.name, stageFingerprint);
    if (cached) {
      return {
        stage: declaration.name,
        status: 'pass',
        state: 'pass',
        cached: true,
        durationMs: cached.durationMs ?? 0,
        findings: [],
        summary: 'cache hit',
      } as ToolOutcome;
    }
    const outcome = await runStructuredTool(declaration, {
      projectRoot: workspace,
      reportRoot,
      logsRoot,
    });
    if (outcome.status === 'pass') {
      await writeCachedPass(cacheContext, declaration.name, stageFingerprint, { status: 'pass', durationMs: outcome.durationMs });
    }
    return outcome;
  }, { maxConcurrency: 1 })) as ToolOutcome[];
  const stages: GateStage[] = outcomes.map(outcome => ({
    stage: outcome.stage,
    status: outcome.status,
    state: outcome.state,
    cached: outcome.cached,
    durationMs: outcome.durationMs,
    findings: outcome.findings,
    summary: outcome.summary,
  }));
  const { report, jsonPath, markdownPath } = await createReport(
    {
      projectRoot: workspace,
      reportRoot,
      heavyDeferred: heavyGuard,
      branch: await gitBranch(workspace),
      tools: {},
      qualityConfig: limits,
    },
    { taskId: args.taskId ?? 'task', ci: requestedCi },
    scope,
    stages,
    [],
    startedAt,
  );
  const output = compactLines({ report, jsonPath, markdownPath }, { projectRoot: workspace, qualityConfig: limits }).join('\n');
  return { exitCode: report.decision.exitCode, output: `${output}\n` };
}
