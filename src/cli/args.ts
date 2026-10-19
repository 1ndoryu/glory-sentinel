/* [108A-1 Fase 2] Barril del parser del CLI: el contrato de '../../cli' sigue
 * resolviendo aquí. Cada símbolo vive en su módulo parseo/args* (argsTypes,
 * argsUsage, argsValue, argsTask, argsParse) para mantener los archivos bajo el límite. */
export type { CliAnalysisResult, CliFormat, ParsedCliArgs, SentinelCliConfigFile, TaskAction, TaskCliArgs, TaskCliResult } from './parseo/argsTypes';
export { SENTINEL_JSON_SCHEMA_VERSION } from './parseo/argsTypes';
export { taskUsage, usage } from './parseo/argsUsage';
export { formatTaskResult, parseTaskCliArgs } from './parseo/argsTask';
export { parseCliArgs } from './parseo/argsParse';
