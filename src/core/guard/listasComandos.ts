/* [SQ-13] Única fuente de las listas genéricas del guard de comandos directos.
 * Los defaults de fallback (sin política v2) de guardCommand.ts salen de aquí, y
 * los presets por stack (init/presets.ts) solo pueden declarar nombres contenidos
 * en estas listas: lo prueba src/test/suite/guard/listasComandos.test.ts. */

/* Scripts de npm que un proyecto no debe lanzar directamente (pasan por el gate). */
export const LISTA_NPM_SCRIPTS = Object.freeze([
  '__sentinel_guard_probe__',
  'test', 'test:changed', 'test:full', 'test:file', 'test:watch',
  'type-check', 'lint', 'check', 'check:back', 'check:front',
  'fmt', 'fmt:check', 'build',
]);

/* Herramientas (binario directo o vía npx) que deben entrar por el gate. */
export const LISTA_TOOLS = Object.freeze(['vitest', 'tsc', 'eslint', 'prettier', 'rustfmt', 'typescript']);

/* Subcomandos de cargo que deben entrar por el gate. */
export const LISTA_CARGO_COMMANDS = Object.freeze(['check', 'clippy', 'test', 'bench', 'fmt', 'nextest']);
