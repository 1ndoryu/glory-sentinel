/* [028A-6 Fase 1/SNT-16d] Diagnóstico del runtime del gate agnóstico para
 * `sentinel doctor`/`status`: política, lock, versiones, herramientas,
 * scheduler y raíz canónica. Solo lectura; nunca muta estado.
 * Fachada: la lógica vive en detalle/diagnose*.ts; este archivo conserva
 * la API pública (mismos exports y mismo path). */
export type { DiagnosePolicy, DiagnoseLock, DiagnoseTool, DiagnoseIssue, DiagnoseAviso, DiagnoseScheduler, DiagnoseLeases, DiagnoseResult } from './detalle/diagnoseTipos';
export { currentBranch } from './detalle/diagnoseGit';
export { formatDiagnose, formatStatus } from './detalle/diagnoseFormato';
export { policyHashFor, diagnoseWorkspace, assertWorkspaceReady } from './detalle/diagnoseWorkspace';
