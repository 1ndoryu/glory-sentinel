#!/usr/bin/env node

/* [108A-1 Fase 2] Barril del CLI único de Sentinel: re-exporta la capa de
 * parsing (./args) y el dispatch de comandos (./commands) y arranca runCli
 * desde el entry point real. El contrato público del módulo '../../cli' no
 * cambia: los imports de tests (parseCliArgs, analyzeCliTarget,
 * SENTINEL_JSON_SCHEMA_VERSION, ...) y el bin de package.json siguen
 * resolviendo aquí. */
export * from './args';
export * from './commands';
export { languageIdForFile } from '../core/language';
import { runCli } from './commands';

if (require.main === module) {
  runCli(process.argv.slice(2))
    .then(code => { process.exitCode = code; })
    .catch(error => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    });
}
