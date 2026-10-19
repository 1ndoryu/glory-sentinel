/* Salida legible del diagnóstico para `sentinel doctor` y `sentinel status`.
 * Solo formatea: no consulta nada ni cambia el resultado. */
import { formatShims } from '../../shims/shimDiagnostics';
import type { DiagnoseResult } from './diagnoseTipos';

export function formatDiagnose(result: DiagnoseResult): string {
  const lines = [
    `Sentinel ${result.sentinelVersion}`,
    `Workspace: ${result.workspace}`,
    `Raíz del gate: ${result.root ?? 'no encontrada'}`,
    `Rama: ${result.branch ?? 'n/a'}`,
    `Política: ${result.policy.status}${result.policy.mode ? ` · modo ${result.policy.mode}` : ''}${result.policy.policyHash ? ` · hash ${result.policy.policyHash.slice(0, 12)}` : ''}`,
    `Lock: ${result.lock.present ? `presente (${result.lock.version ?? '?'} · ${result.lock.commit?.slice(0, 8) ?? '?'})` : 'ausente'}`,
    `Preflight: ${result.ready ? 'PASS' : `BLOQUEADO (${result.issues.length} problemas)`}`,
    /* [108A-1 Fase 1] Readiness explícita en la salida humana: el análisis
     * puede estar listo sin que el gate lo esté (no-policy, sin raíz o
     * política legacy/inválida). Nunca se responde “gate listo” cuando solo
     * existe analyze. */
    `Análisis: ${result.readyForAnalyze ? 'listo' : 'no listo'}`,
    `Gate: ${result.readyForGate ? 'listo' : `no listo${result.policy.status !== 'policy' ? ` (política ${result.policy.status})` : result.root === null ? ' (sin raíz de gate)' : ''}`}`,
    `Scheduler: ${result.scheduler ? `target ${result.scheduler.targetBase}${result.scheduler.stateProjects !== undefined ? ` · ${result.scheduler.stateProjects} proyectos` : ''}${result.scheduler.activePid !== undefined ? ` · activo PID ${String(result.scheduler.activePid)}` : ''}` : 'no disponible'}`,
    `Leases: ${result.leases ? `clave ${result.leases.keyPresent ? 'ok' : 'ausente'} · ${result.leases.active} activas · ${result.leases.expired} expiradas` : 'no disponible'}`,
    `Runtime: ${result.runtime.activeVersion ? `activa v${result.runtime.activeVersion} (${result.runtime.activeVerified ? 'hash verificado' : 'hash pendiente'})` : 'no instalado'} · ${result.runtime.versions.length} versiones en ${result.runtime.targetRoot}`,
  ];
  for (const tool of Object.values(result.tools)) {
    const capabilityText = tool.missingCapabilities.length > 0 ? ` - capabilities missing: ${tool.missingCapabilities.join(',')}` : '';
    const releaseText = tool.releaseReachable ? ` - release refs: ${tool.releaseRefs.join(',')}${tool.releaseEvidencePresent ? ' - clean evidence ok' : ' - clean evidence missing'}` : ' - release unpublished';
    const dependencyText = tool.dependenciesPresent ? '' : ' - dependencies missing';
    const gitlinkText = tool.sourcePath && tool.sourceExternal === false
      ? ` - gitlink HEAD ${tool.gitlinkCommit?.slice(0, 8) ?? 'missing'}${tool.stagedGitlinkCommit && tool.stagedGitlinkCommit !== tool.gitlinkCommit ? ` / index ${tool.stagedGitlinkCommit.slice(0, 8)}` : ''}`
      : '';
    lines.push(`  ${tool.name}: source ${tool.sourcePresent ? 'ok' : 'missing'} - cli ${tool.cliPresent ? 'ok' : 'missing'} - version ${tool.cliVersion ?? 'failed'} - checkout ${tool.checkoutCommit?.slice(0, 8) ?? 'n/a'}${tool.checkoutDirty ? ' - DIRTY' : ''}${gitlinkText}${dependencyText}${capabilityText}${releaseText}`);
  }
  for (const issue of result.issues) lines.push(`ERROR ${issue.code}: ${issue.message}`);
  for (const aviso of result.avisos) lines.push(`AVISO ${aviso.code}: ${aviso.message}`);
  lines.push('');
  lines.push(formatShims(result.shims));
  return lines.join('\n');
}

export function formatStatus(result: DiagnoseResult): string {
  const policy = result.policy.status === 'policy' ? `enforce:${result.policy.mode}` : result.policy.status;
  const lock = result.lock.present ? (result.lock.commit?.slice(0, 8) ?? 'locked') : 'no-lock';
  const runtime = result.runtime.activeVersion ? `runtime v${result.runtime.activeVersion}` : 'runtime none';
  return `sentinel ${result.sentinelVersion} · ${policy} · lock ${lock} · preflight ${result.ready ? 'pass' : 'blocked'} · root ${result.root ?? 'none'} · ${runtime}`;
}
