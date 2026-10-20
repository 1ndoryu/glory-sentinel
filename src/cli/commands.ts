/* [108A-1 Fase 2] Barril de los handlers del CLI: viven en comandos/cli*.ts.
 * runCli no pasa por aquí; index.ts lo toma de cliMain.ts directamente. */
export { analyzeCliTarget } from './comandos/cliAnalyze';
export { checkCliTarget, taskCliTarget } from './comandos/cliGate';
export type { TaskCliExecution } from './comandos/cliGate';
export { leaseCliTarget } from './comandos/cliLease';
export { diagnoseCliTarget, guardCliTarget, installCliTarget, rollbackCliTarget, uninstallCliTarget } from './comandos/cliRuntime';
