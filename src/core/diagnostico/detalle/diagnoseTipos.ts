/* [028A-6 Fase 1/SNT-16d] Tipos del diagnóstico del runtime del gate. Viven
 * aparte para que los módulos hermanos los compartan sin importar la fachada
 * diagnose.ts (evita ciclos de importación). */
import type { RuntimeStatusResult } from '../../runtime-proyecto/runtimeInstall';
import type { DiagnoseShimEntry } from '../../shims/shimDiagnostics';

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
  provisionPath: string | null;
  sourceExternal: boolean;
  cliPath: string | null;
  cliVersion: string | null;
  configuredVersion: string | null;
  lockVersion: string | null;
  configuredCommit: string | null;
  gitlinkCommit: string | null;
  stagedGitlinkCommit: string | null;
  checkoutCommit: string | null;
  lockCommit: string | null;
  sourcePresent: boolean;
  cliPresent: boolean;
  cliResponds: boolean;
  cliCapabilities: string[];
  missingCapabilities: string[];
  /** [108A-1 Fase 2] Capabilities opcionales declaradas (task, recover,
   * shims...): su ausencia NO bloquea el doctor; solo se reporta. */
  optionalCapabilities: string[];
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

/* [10AA-2 F11.2] Aviso: informa sin bloquear el preflight (a diferencia de issues). */
export interface DiagnoseAviso {
  code: string;
  message: string;
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
  shims: Record<string, DiagnoseShimEntry>;
  issues: DiagnoseIssue[];
  avisos: DiagnoseAviso[];
  ready: boolean;
  /* [108A-1 Fase 1] Readiness separada: readyForAnalyze (el analizador puede
   * correr en esta carpeta) vs readyForGate (el quality gate puede ejecutarse:
   * hay raíz de gate y una política v2 válida). Un proyecto no-policy o sin
   * raíz NUNCA declara gate listo, aunque ready sea true (el CLI analyze sí
   * funciona). ready se conserva por compatibilidad = readyForAnalyze. */
  readyForAnalyze: boolean;
  readyForGate: boolean;
  runtime: RuntimeStatusResult;
}
