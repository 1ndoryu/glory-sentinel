/* [10AA-2] Entrada del guard sin el CLI completo. `current.js guard …` la carga
 * en el mismo proceso (un arranque de node por comando, sin los ~154 módulos del
 * CLI). Parseo y salida idénticos a `sentinel guard` (args.ts / commands.ts):
 * guardCliTarget delega aquí, así hay una sola implementación. */
import { formatBlockMessage, inspectDirectCommand, QUALITY_GUARD_EXIT_CODE } from './guardCommand';

export interface GuardArgv {
  executable: string;
  projectRoot?: string;
  workspace?: string;
  json: boolean;
  guardArgs: string[];
}

/* Espera argv = ['guard', ...]. Mismo contrato que args.ts: las opciones van
 * antes de `--` y los argumentos de la herramienta después. */
export function parseGuardArgv(argv: string[]): GuardArgv {
  const separator = argv.indexOf('--');
  const before = argv.slice(1, separator === -1 ? argv.length : separator);
  const parsed: GuardArgv = { executable: '', json: false, guardArgs: separator === -1 ? [] : argv.slice(separator + 1) };
  const valueOf = (index: number, flag: string): string => {
    const value = before[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`falta valor para ${flag}`);
    return value;
  };
  for (let index = 0; index < before.length; index++) {
    const arg = before[index];
    if (arg === '--executable') {
      parsed.executable = valueOf(index, arg);
      index++;
    } else if (arg === '--project-root') {
      parsed.projectRoot = valueOf(index, arg);
      index++;
    } else if (arg === '--workspace') {
      parsed.workspace = valueOf(index, arg);
      index++;
    } else if (arg === '--json') {
      parsed.json = true;
    } else {
      throw new Error(`opción desconocida para guard: ${arg}`);
    }
  }
  return parsed;
}

export interface GuardCommandOptions {
  executable: string;
  args?: string[];
  cwd?: string;
  projectRoot?: string;
  json?: boolean;
}

/* Código de salida: 0 pasa, 78 bloquea. Escribe en stdout (JSON) o stderr (texto). */
export async function runGuardCommand(options: GuardCommandOptions): Promise<number> {
  const decision = await inspectDirectCommand({
    executable: options.executable,
    args: options.args ?? [],
    cwd: options.cwd ?? process.cwd(),
    projectRoot: options.projectRoot,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  } else if (decision.blocked) {
    process.stderr.write(`${formatBlockMessage(decision)}\n`);
  }
  return decision.blocked ? (decision.exitCode ?? QUALITY_GUARD_EXIT_CODE) : 0;
}

/* Punto de entrada de current.js: argv completo (incluido 'guard'). */
export async function runGuardEntry(argv: string[]): Promise<number> {
  const parsed = parseGuardArgv(argv);
  return runGuardCommand({
    executable: parsed.executable,
    args: parsed.guardArgs,
    cwd: parsed.workspace,
    projectRoot: parsed.projectRoot,
    json: parsed.json,
  });
}
