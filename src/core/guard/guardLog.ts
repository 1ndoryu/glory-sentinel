/* [10AA-2 F11.2] Registro de actividad del guard: una línea NDJSON por decisión
 * (bloqueo, observación o paso con motivo). Vive fuera de los proyectos, en
 * C:\tmp\glory-quality-guard, para que `sentinel doctor` y la vigilancia del
 * área lo lean sin tocar repos. Es best-effort: un fallo de disco nunca cambia
 * la decisión del guard ni el exit code del comando. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { cargoSubcommand, type GuardDecision } from './guardCommand';
import { tmpBaseDir } from '../seguridad-rutas/tmpDir';

/* Tope por fichero: al superarlo se rota a guard-log.1.ndjson (sustituye al
 * anterior), así el total queda acotado a ~2 MiB. */
export const GUARD_LOG_MAX_BYTES = 1024 * 1024;
const GUARD_LOG_FILE = 'guard-log.ndjson';
const GUARD_LOG_ROTATED = 'guard-log.1.ndjson';
const COMANDO_MAX_CHARS = 120;

/* GLORY_GUARD_LOG_DIR permite aislar el registro (los tests lo fijan). */
export function guardLogDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GLORY_GUARD_LOG_DIR) return env.GLORY_GUARD_LOG_DIR;
  return path.join(tmpBaseDir(env), 'glory-quality-guard');
}

/* Solo ejecutable y subcomando: nunca el resto de argumentos (pueden llevar
 * rutas, tokens o valores de configuración). */
export function resumenComando(executable: string, args: string[] = []): string {
  const name = executable.toLowerCase().replace(/\.exe$/u, '');
  const subcommand = name === 'cargo'
    ? cargoSubcommand(args)
    : args.find(arg => !arg.startsWith('-'));
  return subcommand ? `${executable} ${subcommand}` : executable;
}

export function clasificarDecision(decision: GuardDecision): 'bloqueado' | 'observado' | 'paso' {
  if (decision.blocked) return 'bloqueado';
  return decision.observed ? 'observado' : 'paso';
}

export async function registrarDecision(
  decision: GuardDecision,
  executable: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    const dir = guardLogDir(env);
    const file = path.join(dir, GUARD_LOG_FILE);
    const linea = `${JSON.stringify({
      fecha: new Date().toISOString(),
      proyecto: decision.root,
      comando: resumenComando(executable, args).slice(0, COMANDO_MAX_CHARS),
      decision: clasificarDecision(decision),
      motivo: decision.reason ?? decision.policyStatus ?? 'sin-motivo',
    })}\n`;
    await fs.mkdir(dir, { recursive: true });
    await rotarSiHaceFalta(dir, file, Buffer.byteLength(linea));
    await fs.appendFile(file, linea, 'utf8');
  } catch {
    /* Best-effort: el guard decide; el registro solo informa. */
  }
}

async function rotarSiHaceFalta(dir: string, file: string, extra: number): Promise<void> {
  let tamano: number;
  try {
    tamano = (await fs.stat(file)).size;
  } catch {
    return;
  }
  /* En Windows rename sustituye al destino existente (MOVEFILE_REPLACE_EXISTING). */
  if (tamano + extra > GUARD_LOG_MAX_BYTES) {
    await fs.rename(file, path.join(dir, GUARD_LOG_ROTATED));
  }
}
