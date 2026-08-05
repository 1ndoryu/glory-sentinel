/* [028A-6 Fase 4] Helpers compartidos de la matriz multi-proyecto.
 * La copia a tmp es OBLIGATORIA para los casos no-policy y shell reales:
 * findQualityRoot camina hacia arriba desde el cwd, y los fixtures viven
 * dentro del repo de Sentinel cuyo padre tiene política enforce — sin copia,
 * un fixture sin marcador "heredaría" la política del repo y rompería el test.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { writeInterceptorShims } from '../../core/interceptorShims';

export function fixtureSourceDir(name: string): string {
  return path.resolve(__dirname, '../../../src/test/fixtures/guard-matrix', name);
}

export function copyFixtureToTmp(name: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `sentinel-matrix-${name}-`));
  fs.cpSync(fixtureSourceDir(name), path.join(tmp, 'project'), { recursive: true });
  return path.join(tmp, 'project');
}

export function v2Policy(mode: string, directCommands: Record<string, string[]>): string {
  return JSON.stringify({
    schemaVersion: 2,
    mode,
    gate: { command: ['sentinel', 'check', '--'], taskIdRequired: true },
    guard: { directCommands },
  }, null, 2);
}

/* [028A-6] Sandbox del runtime para la matriz real de shells: escribe en un
 * target temporal el current.js que reenvía al CLI compilado del checkout
 * (equivalente al que genera installRuntime) y genera los shims interceptores
 * apuntando a ese target. Devuelve el directorio de shims. */
export async function writeSandboxRuntime(targetRoot: string, repoRoot: string): Promise<string> {
  const cli = path.join(repoRoot, 'out', 'cli', 'index.js');
  if (!fs.existsSync(cli)) throw new Error(`CLI compilado no existe: ${cli}`);
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(path.join(targetRoot, 'current.js'), [
    '#!/usr/bin/env node',
    '/* [028A-6 Fase 4] Reenvío al CLI compilado del checkout (equivalente al current.js del runtime). */',
    `const cli = ${JSON.stringify(cli)};`,
    "const { spawnSync } = require('node:child_process');",
    'const child = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit" });',
    'process.exit(child.status ?? 2);',
    '',
  ].join('\n'), 'utf8');
  const result = await writeInterceptorShims(targetRoot);
  return result.shimDir;
}

/* [028A-6] Env del hijo de la matriz: PATH con los shims al frente y sin
 * GlorySentinel ni scripts/quality del repo (la resolución del real debe ser
 * determinista: `where`/`type -P` excluye solo el shim del sandbox). */
export function sandboxEnv(shimDir: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = (base.PATH ?? '')
    .split(';')
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => !/GlorySentinel/iu.test(value) && !/scripts[\\/]quality/iu.test(value));
  return { ...base, PATH: [shimDir, ...clean].join(';') };
}

export interface ShellRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runInShell(shell: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ShellRun {
  const result = spawnSync(shell, args, { cwd, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
}

/* [028A-6] Disponibilidad por binario: cada shell se prueba con su propia
 * invocación inocua; si no existe (p. ej. pwsh fuera de Windows), el test
 * hace skip en vez de fallar. */
export function shellAvailable(shell: string, probeArgs: string[]): boolean {
  const probe = spawnSync(shell, probeArgs, { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  return !probe.error && probe.status !== null;
}

export function bashAvailable(): boolean {
  return shellAvailable('bash', ['-c', 'true']);
}

export function powershellAvailable(): boolean {
  return shellAvailable('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']);
}

export function pwshAvailable(): boolean {
  return shellAvailable('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']);
}

export function cmdAvailable(): boolean {
  const comspec = process.env.ComSpec ?? 'cmd.exe';
  return shellAvailable(comspec, ['/c', 'exit 0']);
}
