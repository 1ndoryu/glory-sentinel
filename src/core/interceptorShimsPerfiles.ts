/* [028A-6] Escritura de shims y gestión de perfiles con backup. */
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import path from 'node:path';
import { writeAtomic } from './atomicFile';
import { assertSafeRuntimePath, LEGACY_MARKERS, PROFILE_MARKER_END, PROFILE_MARKER_START } from './interceptorShimsBase';
import type { InstallProfilesOptions, InstallProfilesResult, ProfileKind, ProfileResult } from './interceptorShimsBase';
import { generateBashGuard, generateCmdShim } from './interceptorShimsGeneradores';
import { generatePowerShellGuard } from './interceptorShimsPowerShell';

/* [028A-6] Escribe los shims en <targetRoot>/shims: npm/npx/cargo.cmd (cmd),
 * global-quality-guard.sh (bash) y global-cargo-guard.ps1 (pwsh).
 * [10AA-2] node.cmd ya no se genera; las instalaciones previas lo retiran. */
export async function writeInterceptorShims(
  targetRoot: string,
  shimDir?: string,
): Promise<{ shimDir: string; files: string[] }> {
  const resolvedRoot = assertSafeRuntimePath(targetRoot);
  const resolvedShimDir = path.resolve(shimDir ?? path.join(resolvedRoot, 'shims'));
  await fs.mkdir(resolvedShimDir, { recursive: true });
  const files: string[] = [];
  const content: ReadonlyArray<readonly [string, string]> = [
    ['npm.cmd', generateCmdShim('npm', resolvedRoot, resolvedShimDir)],
    ['npx.cmd', generateCmdShim('npx', resolvedRoot, resolvedShimDir)],
    ['cargo.cmd', generateCmdShim('cargo', resolvedRoot, resolvedShimDir)],
    ['global-quality-guard.sh', generateBashGuard(resolvedRoot)],
    ['global-cargo-guard.ps1', generatePowerShellGuard(resolvedRoot)],
  ];
  for (const [name, body] of content) {
    const file = path.join(resolvedShimDir, name);
    await writeAtomic(file, body);
    files.push(file);
  }
  /* [10AA-2] Instalaciones previas: node.cmd retirado. Sin él, `node` resuelve
   * al binario real y no pasa por el guard. */
  await fs.rm(path.join(resolvedShimDir, 'node.cmd'), { force: true });
  return { shimDir: resolvedShimDir, files };
}

/* [028A-6] Normaliza un perfil PowerShell antiguo: guardó `` `n `` como
 * texto literal, lo que convertía la siguiente asignación en un comando
 * inválido al iniciar. SOLO se aplica a PowerShell: en bash el texto
 * `` `n `` dentro de un script puede ser legítimo (backtick seguido de n)
 * y no debe tocarse (el repo original aplicaba el fix solo a PS). */
function normalizeProfileText(text: string, kind: ProfileKind): string {
  return kind === 'powershell' ? text.split('`n').join('\n') : text;
}

/* [028A-6] Retira todos los bloques delimitados por marcadores (nuevos y
 * legacy) del contenido de un perfil. Conserva TODO lo anterior al marcador
 * (incluido el salto que precede al bloque) y quita únicamente el bloque y
 * el salto que installProfiles añadió tras él; así el contenido previo a la
 * instalación se restaura byte a byte y los cambios del usuario fuera del
 * bloque nunca se tocan. */
function stripGuardBlocks(content: string): string {
  let result = content;
  const markers: ReadonlyArray<readonly [string, string]> = [
    [PROFILE_MARKER_START, PROFILE_MARKER_END],
    ...LEGACY_MARKERS,
  ];
  for (const [start, end] of markers) {
    let startIndex = result.indexOf(start);
    while (startIndex >= 0) {
      const endIndex = result.indexOf(end, startIndex + start.length);
      if (endIndex < 0) {
        /* Marcador huérfano (bloque truncado): se elimina la línea del start
         * para que la siguiente instalación no acumule marcadores dobles. */
        const lineEnd = result.indexOf('\n', startIndex);
        const cutEnd = lineEnd >= 0 ? lineEnd + 1 : result.length;
        result = `${result.slice(0, startIndex)}${result.slice(cutEnd)}`;
        startIndex = result.indexOf(start);
        continue;
      }
      const after = result.slice(endIndex + end.length);
      /* installProfiles añade un salto tras el bloque: se elimina solo ese. */
      const afterTrimmed = after.startsWith('\r\n')
        ? after.slice(2)
        : after.startsWith('\n')
          ? after.slice(1)
          : after;
      result = `${result.slice(0, startIndex)}${afterTrimmed}`;
      startIndex = result.indexOf(start);
    }
  }
  return result;
}

/* [028A-6] Bloque de dot-source que se inserta en un perfil. PowerShell
 * carga global-cargo-guard.ps1; bash carga global-quality-guard.sh. Cada
 * perfil recibe SOLO la línea de su tipo. */
function guardBlockFor(kind: ProfileKind, shimDir: string): string {
  if (kind === 'powershell') {
    const psPath = path.join(shimDir, 'global-cargo-guard.ps1').replace(/'/g, "''");
    return [
      PROFILE_MARKER_START,
      `# Guard de comandos de Sentinel (runtime global).`,
      `if (Test-Path -LiteralPath '${psPath}') { . '${psPath}' }`,
      PROFILE_MARKER_END,
    ].join('\n');
  }
  const bashPath = path.join(shimDir, 'global-quality-guard.sh').replace(/'/g, "''");
  return [
    PROFILE_MARKER_START,
    `# Guard de comandos de Sentinel (runtime global).`,
    `if [ -f '${bashPath}' ]; then . '${bashPath}'; fi`,
    PROFILE_MARKER_END,
  ].join('\n');
}

/* [028A-6] Instala el bloque de dot-source en los perfiles indicados.
 * Por perfil: (1) backup previo SOLO si el perfil existe y aún no tiene
 * marcadores (el backup guarda el contenido original); (2) retirada de
 * marcadores nuevos y legacy; (3) escritura atómica con el bloque nuevo.
 * Con dry-run no se escribe ni se hace backup. */
export async function installProfiles(options: InstallProfilesOptions): Promise<InstallProfilesResult> {
  const dryRun = Boolean(options.dryRun);
  const backupDir = path.resolve(options.backupDir ?? path.join(options.shimDir, 'profile-backups'));
  const results: ProfileResult[] = [];
  const targets: ReadonlyArray<readonly [ProfileKind, string]> = [
    ...options.profiles.powershell.map(profile => ['powershell', profile] as const),
    ...options.profiles.bash.map(profile => ['bash', profile] as const),
  ];
  for (const [kind, profile] of targets) {
    const resolved = path.resolve(profile);
    /* [028A-6] El nombre del backup incluye un hash del directorio padre:
     * los perfiles PS7 y WindowsPowerShell comparten basename
     * (Microsoft.PowerShell_profile.ps1) y no deben pisar su backup. */
    const parentHash = crypto.createHash('sha256').update(path.dirname(resolved)).digest('hex').slice(0, 8);
    const backup = path.join(backupDir, `${parentHash}-${path.basename(resolved)}.backup`);
    try {
      let content = '';
      let existed = false;
      try {
        content = normalizeProfileText(await fs.readFile(resolved, 'utf8'), kind);
        existed = true;
      } catch {
        /* Perfil inexistente: se crea. */
      }
      const hadMarker = content.includes(PROFILE_MARKER_START) || content.includes(PROFILE_MARKER_END);
      const hadLegacy = LEGACY_MARKERS.some(([start, end]) => content.includes(start) || content.includes(end));
      const stripped = stripGuardBlocks(content);
      const block = guardBlockFor(kind, options.shimDir);
      const separator = stripped.length > 0 && !stripped.endsWith('\n') ? '\n' : '';
      const next = `${stripped}${separator}${block}\n`;
      const changed = next !== content || !existed;
      const action = !changed ? 'unchanged' : hadMarker || hadLegacy ? 'updated' : 'installed';
      if (dryRun) {
        results.push({
          path: resolved,
          action,
          backup: !existed || hadMarker ? null : backup,
        });
        continue;
      }
      let backupWritten: string | null = null;
      if (existed && !hadMarker && !hadLegacy) {
        await fs.mkdir(backupDir, { recursive: true });
        await writeAtomic(backup, content);
        backupWritten = backup;
      }
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await writeAtomic(resolved, next);
      results.push({ path: resolved, action, backup: backupWritten });
    } catch (error) {
      results.push({
        path: resolved,
        action: 'error',
        backup: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { dryRun, profiles: results };
}

/* [028A-6] Retira los bloques de dot-source (nuevos y legacy) de los
 * perfiles. El backup original se conserva para restauración manual
 * documentada; no se borra nada fuera de los marcadores. */
export async function uninstallProfiles(options: InstallProfilesOptions): Promise<InstallProfilesResult> {
  const dryRun = Boolean(options.dryRun);
  const results: ProfileResult[] = [];
  const targets: ReadonlyArray<readonly [ProfileKind, string]> = [
    ...options.profiles.powershell.map(profile => ['powershell', profile] as const),
    ...options.profiles.bash.map(profile => ['bash', profile] as const),
  ];
  for (const [kind, profile] of targets) {
    const resolved = path.resolve(profile);
    try {
      let content: string;
      try {
        content = normalizeProfileText(await fs.readFile(resolved, 'utf8'), kind);
      } catch {
        results.push({ path: resolved, action: 'unchanged', backup: null });
        continue;
      }
      const next = stripGuardBlocks(content);
      if (next === content) {
        results.push({ path: resolved, action: 'unchanged', backup: null });
        continue;
      }
      if (dryRun) {
        results.push({ path: resolved, action: 'removed', backup: null });
        continue;
      }
      await writeAtomic(resolved, next);
      results.push({ path: resolved, action: 'removed', backup: null });
    } catch (error) {
      results.push({
        path: resolved,
        action: 'error',
        backup: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { dryRun, profiles: results };
}

export function formatProfilesResult(result: InstallProfilesResult): string {
  const lines = [`[${result.dryRun ? 'dry-run' : 'ok'}] Perfiles: ${result.profiles.length}`];
  for (const profile of result.profiles) {
    const suffix = profile.error ? ` (${profile.error})` : profile.backup ? ` backup: ${profile.backup}` : '';
    lines.push(`  ${profile.action.padEnd(9)} ${profile.path}${suffix}`);
  }
  return `${lines.join('\n')}\n`;
}
