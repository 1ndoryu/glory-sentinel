/* [108A-1 Fase 2] Barril del dispatch del CLI único de Sentinel: los handlers
 * viven en comandos/cli*.ts y runCli en cliMain.ts. Este módulo solo
 * re-exporta, para mantener el contrato de '../../cli' (index.ts). */
export { analyzeCliTarget } from './comandos/cliAnalyze';
export { checkCliTarget, taskCliTarget } from './comandos/cliGate';
export type { TaskCliExecution } from './comandos/cliGate';
export { leaseCliTarget } from './comandos/cliLease';
export { diagnoseCliTarget, guardCliTarget, installCliTarget, rollbackCliTarget, uninstallCliTarget } from './comandos/cliRuntime';
export { runCli } from './cliMain';
