/* [028A-6 Fase 1] Generación de shims interceptores del runtime global de
 * Sentinel y gestión de perfiles con backup. El runtime es la única fuente
 * de los wrappers: en lugar de mantener npm.cmd/npx.cmd/cargo.cmd/node.cmd
 * y los guards de bash/PowerShell duplicados en cada proyecto, se generan
 * desde el core apuntando al CLI instalado (<targetRoot>/current.js guard).
 * La resolución del ejecutable real es sin recursión (env var primero,
 * `where`/`type -P` excluyendo el propio shim) y preserva argumentos,
 * exit codes y redirecciones. Los perfiles se dot-sourcean solo de forma
 * explícita (--with-profiles) y SIEMPRE con backup previo. */
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import path from 'node:path';
import { writeAtomic } from './atomicFile';

/* Marcadores de bloque en perfiles. Namespace propio del runtime: al
 * instalar se retiran también los marcadores legacy del guard del repo
 * (glory-quality-*) para no duplicar intercepción. */
export const PROFILE_MARKER_START = '# >>> glory-sentinel-global-guard >>>';
export const PROFILE_MARKER_END = '# <<< glory-sentinel-global-guard <<<';

export const LEGACY_MARKERS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['# >>> glory-quality-global-guard >>>', '# <<< glory-quality-global-guard <<<'],
  ['# >>> glory-quality-global-bash-guard >>>', '# <<< glory-quality-global-bash-guard <<<'],
]);

export type ProfileKind = 'powershell' | 'bash';

/* [028A-6] El targetRoot se incrusta en shims ejecutables (cmd/bash/pwsh):
 * es input no confiable y debe pasar un allowlist antes de generar. Un path
 * con comillas, &, % o $ rompería el shim o ejecutaría comandos al
 * invocarlo (shell injection en código generado). */
export function assertSafeRuntimePath(targetRoot: string): string {
  const resolved = path.resolve(targetRoot);
  if (!/^[A-Za-z0-9_\/.:\\ -]+$/u.test(resolved)) {
    throw new Error(`targetRoot contiene caracteres no permitidos para generar shims: ${resolved}`);
  }
  if (resolved.includes('..')) {
    throw new Error(`targetRoot no puede contener '..': ${resolved}`);
  }
  return resolved;
}

export interface ProfilePaths {
  powershell: string[];
  bash: string[];
}

export interface InstallProfilesOptions {
  /** Directorio de los shims generados (la ruta que dot-sourcean los perfiles). */
  shimDir: string;
  profiles: ProfilePaths;
  /** Dry-run: calcula y devuelve las acciones sin escribir nada. */
  dryRun?: boolean;
  /** Directorio de backups. Default: <shimDir>/profile-backups. */
  backupDir?: string;
}

export interface ProfileResult {
  path: string;
  action: 'installed' | 'updated' | 'unchanged' | 'removed' | 'error';
  backup: string | null;
  error?: string;
}

export interface InstallProfilesResult {
  dryRun: boolean;
  profiles: ProfileResult[];
}

/* [028A-6] Candidatos de perfiles por plataforma derivados de variables de
 * entorno; sin tocar nada. El path real de $PROFILE en PowerShell puede
 * estar redirigido por OneDrive; los candidatos se usan solo como base para
 * que el operador confirme antes de --with-profiles. */
export function defaultProfilePaths(env: NodeJS.ProcessEnv = process.env): ProfilePaths {
  const home = env.USERPROFILE ?? env.HOME ?? '';
  const documents = env.USERPROFILE ? path.join(env.USERPROFILE, 'Documents') : home;
  return {
    powershell: [
      path.join(documents, 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      path.join(documents, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    ],
    bash: [
      path.join(home, '.bashrc'),
      path.join(home, '.bash_profile'),
    ],
  };
}

/* [028A-6] Ruta de Windows en el shim cmd: las barras se escapan para el
 * texto .cmd (%RUNTIME_ROOT% con dobles barras). */
function cmdPath(value: string): string {
  return value.replace(/\\/g, '\\\\');
}

/* [028A-6] Shim .cmd para npm/npx/cargo/node. Estructura: (1) resuelve el
 * node real excluyendo su propio node.cmd; (2) resuelve el ejecutable real
 * del comando (env var GLORY_REAL_* primero, `where` excluyendo el propio
 * shim); (3) invoca el guard del runtime (current.js guard); (4) si pasa,
 * reenvía al ejecutable real conservando %* y el exit code. Nunca invoca su
 * propio path: la exclusión de ~f0/~dp0<name>.cmd rompería la recursión. */
export function generateCmdShim(
  name: 'npm' | 'npx' | 'cargo' | 'node',
  targetRoot: string,
): string {
  const runtime = cmdPath(assertSafeRuntimePath(targetRoot));
  const realEnvVar = `GLORY_REAL_${name.toUpperCase()}`;
  const realExe = name === 'cargo' ? 'cargo.exe' : name === 'node' ? 'node.exe' : `${name}.cmd`;
  const selfExclusion = name === 'node'
    ? 'if not "%%~fI"=="%~dp0node.cmd"'
    : `if /I not "%%~fI"=="%~f0"`;
  return [
    '@echo off',
    'setlocal',
    'set "GLORY_SENTINEL_RUNTIME=' + runtime + '"',
    'if not defined GLORY_REAL_NODE (',
    '  for /f "delims=" %%I in (\'where node.exe 2^>nul\') do if not "%%~fI"=="%~dp0node.cmd" if not defined GLORY_REAL_NODE set "GLORY_REAL_NODE=%%~fI"',
    ')',
    'if not defined GLORY_REAL_NODE (',
    '  echo [glory-sentinel] No se encontro el node real fuera del shim. 1>&2',
    '  exit /b 127',
    ')',
    `if not defined ${realEnvVar} (`,
    `  for /f "delims=" %%I in ('where ${realExe} 2^>nul') do ${selfExclusion} if not defined ${realEnvVar} set "${realEnvVar}=%%~fI"`,
    ')',
    `if not defined ${realEnvVar} (`,
    `  echo [glory-sentinel] No se encontro el ${name} real fuera del shim. 1>&2`,
    '  exit /b 127',
    ')',
    `"%GLORY_REAL_NODE%" "%GLORY_SENTINEL_RUNTIME%\\current.js" guard --project-root "%CD%" --executable ${name} -- %*`,
    'if errorlevel 1 exit /b %ERRORLEVEL%',
    `"%${realEnvVar}%" %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
}

/* [028A-6] Guard de bash generado por el runtime. Dot-source en
 * .bashrc/.bash_profile y BASH_ENV; define funciones npm/npx/cargo/node y
 * herramientas que llaman al guard del runtime y reenvían al ejecutable
 * real. La resolución del real nunca cae a la función (usa GLORY_REAL_* y
 * type -P excluyendo el propio directorio), por lo que no hay recursión. */
export function generateBashGuard(targetRoot: string): string {
  return [
    '#!/usr/bin/env bash',
    '# [028A-6] Bash/Git Bash guard generated by Sentinel runtime.',
    '# Sourced by .bashrc/.bash_profile and BASH_ENV so interactive and',
    '# non-interactive shells use the same project-aware command policy.',
    '',
    'export GLORY_SENTINEL_GUARD_LOADED=1',
    'GLORY_SENTINEL_GUARD_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"',
    'export GLORY_SENTINEL_GUARD_DIR',
    /* [028A-6] En bash la ruta se emite con / (la \ es escape y
     * corrompería la ruta Windows al asignarla). cygpath -w la convierte
     * de vuelta cuando el guard la pasa al node. */
    `GLORY_SENTINEL_RUNTIME="${assertSafeRuntimePath(targetRoot).replace(/\\/g, '/')}"`,
    'export GLORY_SENTINEL_RUNTIME',
    '',
    '# [028A-6] Sin GLORY_REAL_NODE el guard invocaría la FUNCIÓN node() de',
    '# forma recursiva. Se resuelve el node real una vez al cargar y se',
    '# exporta; node.cmd del directorio del guard no es ejecutable para bash.',
    'if [[ -z "${GLORY_REAL_NODE:-}" ]]; then',
    '  export GLORY_REAL_NODE="$(type -P node.exe 2>/dev/null || type -P node 2>/dev/null || true)"',
    'fi',
    '',
    'glory_sentinel_host_path() {',
    '  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf \'%s\\n\' "$1"; fi',
    '}',
    '',
    'glory_sentinel_guard() {',
    '  local executable="$1"',
    '  shift',
    '  local node_bin="${GLORY_REAL_NODE:-}"',
    '  [[ -n "$node_bin" ]] || return 0',
    '  local runtime_host',
    '  runtime_host="$(glory_sentinel_host_path "$GLORY_SENTINEL_RUNTIME")"',
    '  local cwd_host',
    '  cwd_host="$(glory_sentinel_host_path "${PWD:-.}")"',
    '  "$node_bin" "$runtime_host/current.js" guard --project-root "$cwd_host" --executable "$executable" -- "$@"',
    '}',
    '',
    'glory_sentinel_real_command() {',
    '  local name="$1"',
    '  local configured=""',
    '  case "$name" in',
    '    cargo) configured="${GLORY_REAL_CARGO:-}" ;;',
    '    npm) configured="${GLORY_REAL_NPM:-}" ;;',
    '    npx) configured="${GLORY_REAL_NPX:-}" ;;',
    '  esac',
    '  if [[ -n "$configured" ]]; then',
    '    if command -v cygpath >/dev/null 2>&1; then',
    '      configured="$(cygpath -u "$configured" 2>/dev/null || printf \'%s\' "$configured")"',
    '    fi',
    '    printf \'%s\\n\' "$configured"',
    '    return 0',
    '  fi',
    '  local candidate',
    '  candidate="$(type -P "${name}.exe" 2>/dev/null || true)"',
    '  [[ -n "$candidate" ]] && { printf \'%s\\n\' "$candidate"; return 0; }',
    '  candidate="$(type -P "$name" 2>/dev/null || true)"',
    '  if [[ -n "$candidate" && "$candidate" != "$GLORY_SENTINEL_GUARD_DIR/$name" && "$candidate" != "$GLORY_SENTINEL_GUARD_DIR/$name.cmd" ]]; then',
    '    printf \'%s\\n\' "$candidate"',
    '    return 0',
    '  fi',
    '  return 1',
    '}',
    '',
    'glory_sentinel_dispatch() {',
    '  local name="$1"',
    '  shift',
    '  glory_sentinel_guard "$name" "$@"',
    '  local guard_exit=$?',
    '  [[ $guard_exit -eq 0 ]] || return "$guard_exit"',
    '  local real_command',
    '  real_command="$(glory_sentinel_real_command "$name" 2>/dev/null)" || {',
    '    printf \'[glory-sentinel] No se encontro el ejecutable real de %s.\\n\' "$name" >&2',
    '    return 127',
    '  }',
    '  "$real_command" "$@"',
    '}',
    '',
    'cargo() { glory_sentinel_dispatch cargo "$@"; }',
    'rustfmt() { glory_sentinel_dispatch rustfmt "$@"; }',
    'npm() { glory_sentinel_dispatch npm "$@"; }',
    'npx() { glory_sentinel_dispatch npx "$@"; }',
    'vitest() { glory_sentinel_dispatch vitest "$@"; }',
    'tsc() { glory_sentinel_dispatch tsc "$@"; }',
    'eslint() { glory_sentinel_dispatch eslint "$@"; }',
    'prettier() { glory_sentinel_dispatch prettier "$@"; }',
    '# [028A-6] node() cubre el bypass por runtime (`node .../vitest.mjs`):',
    '# el guard decide entrypoints de herramientas y cualquier otro uso de',
    '# node se reenvía intacto al node real vía GLORY_REAL_NODE.',
    'node() { glory_sentinel_dispatch node "$@"; }',
    '',
    '# Los procesos bash hijos (no interactivos) cargan este guard vía BASH_ENV.',
    'export BASH_ENV="${BASH_ENV:-${GLORY_SENTINEL_GUARD_DIR}/global-quality-guard.sh}"',
    '',
  ].join('\n');
}

/* [028A-6] Guard de PowerShell generado por el runtime. Dot-source en el
 * perfil; define funciones que llaman al guard del runtime y reenvían al
 * ejecutable real. Get-Command -CommandType Application no devuelve
 * funciones, por lo que node() resuelve el binario real sin recursión. */
export function generatePowerShellGuard(targetRoot: string): string {
  const runtime = assertSafeRuntimePath(targetRoot).replace(/'/g, "''");
  return [
    '<#',
    '.SYNOPSIS',
    '    PowerShell guard generated by Sentinel runtime.',
    '.DESCRIPTION',
    '    Routes direct validation commands through the Sentinel runtime guard.',
    '    Non-Glory projects and development commands pass through unchanged.',
    '#>',
    '',
    `$script:GLORY_SENTINEL_RUNTIME = '${runtime}'`,
    '$script:GLORY_SENTINEL_GUARD_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '',
    'function Find-GlorySentinelQualityRoot {',
    '    param([string]$StartPath = (Get-Location).Path)',
    '    $candidate = [System.IO.Path]::GetFullPath($StartPath)',
    '    while ($candidate) {',
    '        if ((Test-Path (Join-Path $candidate \'sentinel.config.json\')) -or',
    '            (Test-Path (Join-Path $candidate \'quality.config.json\'))) {',
    '            return $candidate',
    '        }',
    '        $parent = Split-Path -Parent $candidate',
    '        if (-not $parent -or $parent -eq $candidate) { break }',
    '        $candidate = $parent',
    '    }',
    '    return $null',
    '}',
    '',
    'function Invoke-GlorySentinelCommandGuard {',
    '    param(',
    '        [Parameter(Mandatory = $true)][string]$Executable,',
    '        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments',
    '    )',
    '    $qualityRoot = Find-GlorySentinelQualityRoot',
    '    if (-not $qualityRoot) { return 0 }',
    '    $node = (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source',
    '    if (-not $node) { return 0 }',
    '    & $node (Join-Path $script:GLORY_SENTINEL_RUNTIME \'current.js\') guard --project-root $qualityRoot --executable $Executable -- @Arguments',
    '    return $LASTEXITCODE',
    '}',
    '',
    'function Resolve-GlorySentinelExternalCommand {',
    '    param([Parameter(Mandatory = $true)][string]$Name, [string]$ConfiguredVariable)',
    '    if ($ConfiguredVariable) {',
    '        $configured = [Environment]::GetEnvironmentVariable($ConfiguredVariable, \'Process\')',
    '        if ($configured -and (Test-Path -LiteralPath $configured)) { return $configured }',
    '        $configured = [Environment]::GetEnvironmentVariable($ConfiguredVariable, \'User\')',
    '        if ($configured -and (Test-Path -LiteralPath $configured)) { return $configured }',
    '    }',
    '    $shimPath = Join-Path $script:GLORY_SENTINEL_GUARD_DIR "$Name.cmd"',
    '    $command = Get-Command "$Name.cmd" -CommandType Application -ErrorAction SilentlyContinue |',
    '        Where-Object { $_.Source -ne $shimPath } |',
    '        Select-Object -First 1',
    '    if (-not $command) { throw "No se encontro el ejecutable real de $Name" }',
    '    return $command.Source',
    '}',
    '',
    'function cargo {',
    '    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CargoArguments)',
    '    $qualityExit = Invoke-GlorySentinelCommandGuard -Executable \'cargo\' -Arguments $CargoArguments',
    '    if ($qualityExit -ne 0) { return $qualityExit }',
    '    $realCargo = (Get-Command cargo.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source',
    '    if (-not $realCargo) { return 127 }',
    '    & $realCargo @CargoArguments',
    '    return $LASTEXITCODE',
    '}',
    '',
    'function npm {',
    '    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$NpmArguments)',
    '    $qualityExit = Invoke-GlorySentinelCommandGuard -Executable \'npm\' -Arguments $NpmArguments',
    '    if ($qualityExit -ne 0) { return $qualityExit }',
    '    $realNpm = Resolve-GlorySentinelExternalCommand -Name \'npm\' -ConfiguredVariable \'GLORY_REAL_NPM\'',
    '    & $realNpm @NpmArguments',
    '    return $LASTEXITCODE',
    '}',
    '',
    'function npx {',
    '    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$NpxArguments)',
    '    $qualityExit = Invoke-GlorySentinelCommandGuard -Executable \'npx\' -Arguments $NpxArguments',
    '    if ($qualityExit -ne 0) { return $qualityExit }',
    '    $realNpx = Resolve-GlorySentinelExternalCommand -Name \'npx\' -ConfiguredVariable \'GLORY_REAL_NPX\'',
    '    & $realNpx @NpxArguments',
    '    return $LASTEXITCODE',
    '}',
    '',
    'function node {',
    '    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$NodeArguments)',
    '    $qualityExit = Invoke-GlorySentinelCommandGuard -Executable \'node\' -Arguments $NodeArguments',
    '    if ($qualityExit -ne 0) { return $qualityExit }',
    '    $realNode = (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source',
    '    if (-not $realNode) { return 127 }',
    '    & $realNode @NodeArguments',
    '    return $LASTEXITCODE',
    '}',
    '',
    'function vitest {',
    '    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$VitestArguments)',
    '    $qualityExit = Invoke-GlorySentinelCommandGuard -Executable \'vitest\' -Arguments $VitestArguments',
    '    if ($qualityExit -ne 0) { return $qualityExit }',
    '    $realVitest = Resolve-GlorySentinelExternalCommand -Name \'vitest\'',
    '    & $realVitest @VitestArguments',
    '    return $LASTEXITCODE',
    '}',
    '',
    'function tsc {',
    '    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$TscArguments)',
    '    $qualityExit = Invoke-GlorySentinelCommandGuard -Executable \'tsc\' -Arguments $TscArguments',
    '    if ($qualityExit -ne 0) { return $qualityExit }',
    '    $realTsc = Resolve-GlorySentinelExternalCommand -Name \'tsc\'',
    '    & $realTsc @TscArguments',
    '    return $LASTEXITCODE',
    '}',
    '',
  ].join('\r\n');
}

/* [028A-6] Escribe los shims en <targetRoot>/shims: npm/npx/cargo/node.cmd
 * (cmd), global-quality-guard.sh (bash) y global-cargo-guard.ps1 (pwsh). */
export async function writeInterceptorShims(
  targetRoot: string,
  shimDir?: string,
): Promise<{ shimDir: string; files: string[] }> {
  const resolvedRoot = assertSafeRuntimePath(targetRoot);
  const resolvedShimDir = path.resolve(shimDir ?? path.join(resolvedRoot, 'shims'));
  await fs.mkdir(resolvedShimDir, { recursive: true });
  const files: string[] = [];
  const content: ReadonlyArray<readonly [string, string]> = [
    ['npm.cmd', generateCmdShim('npm', resolvedRoot)],
    ['npx.cmd', generateCmdShim('npx', resolvedRoot)],
    ['cargo.cmd', generateCmdShim('cargo', resolvedRoot)],
    ['node.cmd', generateCmdShim('node', resolvedRoot)],
    ['global-quality-guard.sh', generateBashGuard(resolvedRoot)],
    ['global-cargo-guard.ps1', generatePowerShellGuard(resolvedRoot)],
  ];
  for (const [name, body] of content) {
    const file = path.join(resolvedShimDir, name);
    await writeAtomic(file, body);
    files.push(file);
  }
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
