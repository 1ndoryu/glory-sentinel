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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
  if (!/^[A-Za-z0-9_/.:\\ -]+$/u.test(resolved)) {
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

/* [028A-6] Shim .cmd para npm/npx/cargo. Estructura: (1) sube desde %CD%
 * buscando un marcador de política (sentinel.config.json o quality.config.json);
 * sin marcador va directo al ejecutable real sin arrancar node: no hay nada que
 * decidir (camino rápido, [10AA-2]); (2) con marcador resuelve el node real y
 * llama al guard del runtime (current.js guard); (3) si no bloquea, resuelve el
 * ejecutable real (env var GLORY_REAL_* primero, `where` excluyendo el propio
 * shim) y reenvía conservando %* y el exit code. Nunca invoca su propio path.
 * Limitación: la subida usa la ruta lógica de %CD%; un cwd dentro de un
 * junction hacia un proyecto con marcador no pasa por el guard (node usa realpath). */
export function generateCmdShim(
  name: 'npm' | 'npx' | 'cargo',
  targetRoot: string,
  shimDir?: string,
): string {
  const resolvedRoot = assertSafeRuntimePath(targetRoot);
  const runtime = resolvedRoot;
  /* Los shims estándar viven en <runtime>/shims. Resolver el entrypoint con
   * %~dp0 hace que cmd use la ubicación del shim y no el cwd del proceso.
   * El fallback absoluto conserva compatibilidad con shimDir personalizado. */
  const resolvedShimDir = path.resolve(shimDir ?? path.join(resolvedRoot, 'shims'));
  const standardShimDir = path.resolve(path.join(resolvedRoot, 'shims'));
  const currentScript = resolvedShimDir === standardShimDir
    ? '%~dp0..\\current.js'
    : '%GLORY_SENTINEL_RUNTIME%\\current.js';
  const realEnvVar = `GLORY_REAL_${name.toUpperCase()}`;
  const realExe = name === 'cargo' ? 'cargo.exe' : `${name}.cmd`;
  return [
    '@echo off',
    'setlocal',
    'set "GLORY_SENTINEL_RUNTIME=' + runtime + '"',
    'set "GLORY_SENTINEL_DIR=%CD%"',
    ':glory_up',
    'if exist "%GLORY_SENTINEL_DIR%\\sentinel.config.json" goto glory_guard',
    'if exist "%GLORY_SENTINEL_DIR%\\quality.config.json" goto glory_guard',
    'for %%P in ("%GLORY_SENTINEL_DIR%\\..") do set "GLORY_SENTINEL_PARENT=%%~fP"',
    'if "%GLORY_SENTINEL_PARENT%"=="%GLORY_SENTINEL_DIR%" goto glory_real',
    'set "GLORY_SENTINEL_DIR=%GLORY_SENTINEL_PARENT%"',
    'goto glory_up',
    ':glory_guard',
    'if not defined GLORY_REAL_NODE (',
    '  for /f "delims=" %%I in (\'where node.exe 2^>nul\') do if not defined GLORY_REAL_NODE set "GLORY_REAL_NODE=%%~fI"',
    ')',
    'if not defined GLORY_REAL_NODE (',
    '  echo [glory-sentinel] No se encontro el node real fuera del shim. 1>&2',
    '  exit /b 127',
    ')',
    `"%GLORY_REAL_NODE%" "${currentScript}" guard --project-root "%CD%" --executable ${name} -- %*`,
    'if errorlevel 1 exit /b %ERRORLEVEL%',
    ':glory_real',
    `if not defined ${realEnvVar} (`,
    `  for /f "delims=" %%I in ('where ${realExe} 2^>nul') do if /I not "%%~fI"=="%~f0" if not defined ${realEnvVar} set "${realEnvVar}=%%~fI"`,
    ')',
    `if not defined ${realEnvVar} (`,
    `  echo [glory-sentinel] No se encontro el ${name} real fuera del shim. 1>&2`,
    '  exit /b 127',
    ')',
    `"%${realEnvVar}%" %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
}

/* [028A-6] Guard de bash generado por el runtime. Dot-source en
 * .bashrc/.bash_profile y BASH_ENV; define funciones npm/npx/cargo y
 * herramientas que llaman al guard del runtime y reenvían al ejecutable
 * real. La resolución del real nunca cae a la función (usa GLORY_REAL_* y
 * type -P excluyendo el propio directorio), por lo que no hay recursión.
 * [10AA-2] Sin marcador de política hacia arriba no se arranca node: el
 * comando va directo al real. `node` no está envuelto (ver nota en el cuerpo). */
export function generateBashGuard(targetRoot: string): string {
  return [
    '#!/usr/bin/env bash',
    '# [028A-6] Bash/Git Bash guard generated by Sentinel runtime.',
    '# Sourced by .bashrc/.bash_profile and BASH_ENV so interactive and',
    '# non-interactive shells use the same project-aware command policy.',
    '',
    'export GLORY_SENTINEL_GUARD_LOADED=1',
    '# [10AA-2] Sin subshells en el camino caliente: cada $(…) es un fork (~0,17 s en Git Bash).',
    '# Con ruta absoluta el directorio se deriva sin cd.',
    'glory_sentinel_src="${BASH_SOURCE[0]}"',
    'GLORY_SENTINEL_GUARD_DIR="${glory_sentinel_src%/*}"',
    'case "$GLORY_SENTINEL_GUARD_DIR" in',
    '  /*|[A-Za-z]:*) ;;',
    '  *) GLORY_SENTINEL_GUARD_DIR="$(cd -- "$(dirname -- "$glory_sentinel_src")" && pwd -P)" ;;',
    'esac',
    'export GLORY_SENTINEL_GUARD_DIR',
    'unset glory_sentinel_src',
    /* [028A-6] En bash la ruta se emite con / (la \ es escape y
     * corrompería la ruta Windows al asignarla). Node acepta C:/… tal cual,
     * así que el guard no la convierte (sin fork). */
    `GLORY_SENTINEL_RUNTIME="${assertSafeRuntimePath(targetRoot).replace(/\\/g, '/')}"`,
    'export GLORY_SENTINEL_RUNTIME',
    '',
    '# [10AA-2] node se ejecuta por nombre (PATH, sin subshell). El node.cmd del',
    '# directorio del guard no es ejecutable para bash y no se usa.',
    'GLORY_REAL_NODE="${GLORY_REAL_NODE:-node}"',
    'export GLORY_REAL_NODE',
    '',
    '# Deja en GLORY_SENTINEL_HOST la ruta $1 en formato Windows, sin subshell:',
    '# /c/… pasa a C:\\…; solo las rutas sin unidad montada llaman a cygpath.',
    'glory_sentinel_host_path() {',
    '  local p="$1"',
    '  if [[ "$p" =~ ^/([A-Za-z])(/.*)?$ ]]; then',
    '    p="${BASH_REMATCH[1]^^}:${BASH_REMATCH[2]:-/}"',
    '  elif command -v cygpath >/dev/null 2>&1; then',
    '    p="$(cygpath -w "$p")"',
    '  fi',
    '  GLORY_SENTINEL_HOST="${p//\\//\\\\}"',
    '}',
    '',
    'glory_sentinel_guard() {',
    '  local executable="$1"',
    '  shift',
    '  local node_bin="${GLORY_REAL_NODE:-node}"',
    '  type -P "$node_bin" >/dev/null 2>&1 || return 0',
    '  glory_sentinel_host_path "${PWD:-.}"',
    '  "$node_bin" "$GLORY_SENTINEL_RUNTIME/current.js" guard --project-root "$GLORY_SENTINEL_HOST" --executable "$executable" -- "$@"',
    '}',
    '',
    '# [10AA-2] Camino rápido: sin sentinel.config.json/quality.config.json hacia',
    '# arriba desde $PWD no hay política que aplicar y no se arranca node.',
    '# La base se normaliza sin barra final: en "/" una ruta "//x" es UNC en',
    '# Windows y su comprobación de existencia tarda segundos por resolución de red.',
    'glory_sentinel_has_marker() {',
    '  local dir="${PWD:-.}"',
    '  local base',
    '  while :; do',
    '    base="${dir%/}"',
    '    [[ -f "$base/sentinel.config.json" || -f "$base/quality.config.json" ]] && return 0',
    '    local parent="${dir%/*}"',
    '    [[ -n "$parent" ]] || parent="/"',
    '    [[ "$parent" != "$dir" ]] || return 1',
    '    dir="$parent"',
    '  done',
    '}',
    '',
    'glory_sentinel_dispatch() {',
    '  local name="$1"',
    '  shift',
    '  if glory_sentinel_has_marker; then',
    '    glory_sentinel_guard "$name" "$@"',
    '    local guard_exit=$?',
    '    [[ $guard_exit -eq 0 ]] || return "$guard_exit"',
    '  fi',
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
    '    "$configured" "$@"',
    '    return',
    '  fi',
    '  # command salta las funciones de este guard: el real se ejecuta sin recursión.',
    '  type -P "$name" >/dev/null 2>&1 || {',
    '    printf \'[glory-sentinel] No se encontro el ejecutable real de %s.\\n\' "$name" >&2',
    '    return 127',
    '  }',
    '  command "$name" "$@"',
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
    '# [10AA-2] node no se envuelve: el guard no decide sobre node y envolverlo',
    '# sólo añadía coste. El bypass `node .../vitest.mjs` queda abierto hasta F11.2.',
    '',
    '# Los procesos bash hijos (no interactivos) cargan este guard vía BASH_ENV.',
    'export BASH_ENV="${BASH_ENV:-${GLORY_SENTINEL_GUARD_DIR}/global-quality-guard.sh}"',
    '',
  ].join('\n');
}

/* [028A-6] Guard de PowerShell generado por el runtime. Dot-source en el
 * perfil; define funciones que llaman al guard del runtime y reenvían al
 * ejecutable real. Get-Command -CommandType Application no devuelve
 * funciones, por lo que la resolución del binario real no entra en recursión.
 * [10AA-2] Sin marcador (Find-GlorySentinelQualityRoot) retorna sin arrancar
 * node. `node` no está envuelto: el guard no decide sobre él. */
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
    '    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1',
    '    if (-not $nodeCommand) { $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }',
    '    $node = $nodeCommand.Source',
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
    '    $commands = @(',
    '        (Get-Command "$Name.cmd" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1),',
    '        (Get-Command "$Name" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)',
    '    ) | Where-Object { $_ }',
    '    $command = $commands |',
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
    '    $realCargoCommand = Get-Command cargo.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1',
    '    if (-not $realCargoCommand) { $realCargoCommand = Get-Command cargo -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }',
    '    $realCargo = $realCargoCommand.Source',
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

/* [028A-6 Fase 3] Gestión del PATH de usuario para los shims del runtime.
 * El runtime es autónomo: instala el runtime, genera los shims, dot-sourcea
 * los perfiles (--with-profiles) y puede exponer <target>/shims en el PATH
 * de usuario (--with-path) sin conocer repositorios concretos. La lectura y
 * escritura del PATH de usuario son inyectables para tests; la implementación
 * real usa PowerShell ([Environment]::...User), igual que el instalador
 * legacy del repo. Fuera de Windows devuelve 'unsupported' (la matriz
 * multi-shell es Fase 4). */

const execFileAsync = promisify(execFile);

export function shimsPathFor(targetRoot: string): string {
  return path.join(assertSafeRuntimePath(targetRoot), 'shims');
}

/* [028A-6 Fase 3] Directorios del runtime que se exponen en el PATH de
 * usuario: <target>/shims (interceptores npm/npx/cargo/node) y <target>/bin
 * (el CLI `sentinel`). Ambos son administrados por el runtime. */
export function runtimePathEntries(targetRoot: string): string[] {
  const resolved = assertSafeRuntimePath(targetRoot);
  return [path.join(resolved, 'shims'), path.join(resolved, 'bin')];
}

export interface PathEntryOptions {
  dryRun?: boolean;
  read?: () => Promise<string | null>;
  write?: (value: string) => Promise<void>;
}

export interface PathEntryResult {
  action: 'added' | 'removed' | 'unchanged' | 'unsupported' | 'error';
  path: string;
  /** Próximo valor del PATH (solo dry-run). */
  next?: string;
  error?: string;
}

async function defaultReadUserPath(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"],
      { windowsHide: true, timeout: 8000 },
    );
    const value = String(stdout).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function defaultWriteUserPath(value: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const safe = value.replace(/'/gu, "''");
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `[Environment]::SetEnvironmentVariable('Path', '${safe}', 'User')`],
    { windowsHide: true, timeout: 8000 },
  );
}

function pathEntriesEqual(left: string, right: string): boolean {
  const compare = process.platform === 'win32' ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase() : (a: string, b: string) => a === b;
  return compare(left.replace(/\\/gu, '/').replace(/\/$/u, ''), right.replace(/\\/gu, '/').replace(/\/$/u, ''));
}

/* [028A-6 Fase 3] Asegura que los directorios administrados del runtime
 * (shims + bin) estén al principio del PATH de usuario (Windows).
 * Idempotente: si ya están, 'unchanged'. Con dry-run solo calcula y devuelve
 * el próximo valor. 'unsupported' cuando no hay PATH de usuario
 * administrable en la plataforma o la lectura falla. */
export async function installPathEntry(targetRoot: string, options: PathEntryOptions = {}): Promise<PathEntryResult> {
  const managed = runtimePathEntries(targetRoot);
  const label = managed.join('; ');
  const read = options.read ?? defaultReadUserPath;
  const write = options.write ?? defaultWriteUserPath;
  try {
    const current = await read();
    if (current === null) return { action: 'unsupported', path: label };
    const existing = current.split(';').map(value => value.trim()).filter(Boolean);
    const missing = managed.filter(entry => !existing.some(value => pathEntriesEqual(value, entry)));
    if (missing.length === 0) return { action: 'unchanged', path: label };
    const withoutManaged = existing.filter(value => !managed.some(entry => pathEntriesEqual(value, entry)));
    const next = [...managed, ...withoutManaged].join(';');
    if (options.dryRun) return { action: 'added', path: label, next };
    await write(next);
    return { action: 'added', path: label };
  } catch (error) {
    return { action: 'error', path: label, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function uninstallPathEntry(targetRoot: string, options: PathEntryOptions = {}): Promise<PathEntryResult> {
  const managed = runtimePathEntries(targetRoot);
  const label = managed.join('; ');
  const read = options.read ?? defaultReadUserPath;
  const write = options.write ?? defaultWriteUserPath;
  try {
    const current = await read();
    if (current === null) return { action: 'unsupported', path: label };
    const existing = current.split(';').map(value => value.trim()).filter(Boolean);
    const next = existing.filter(value => !managed.some(entry => pathEntriesEqual(value, entry))).join(';');
    if (next === current) return { action: 'unchanged', path: label };
    if (options.dryRun) return { action: 'removed', path: label, next };
    await write(next);
    return { action: 'removed', path: label };
  } catch (error) {
    return { action: 'error', path: label, error: error instanceof Error ? error.message : String(error) };
  }
}

export function formatPathEntryResult(result: PathEntryResult): string {
  const prefix = result.action === 'error' ? 'ERROR' : result.action.toUpperCase();
  const suffix = result.error ? ` (${result.error})` : result.next ? ` → ${result.next}` : '';
  return `[path] ${prefix} ${result.path}${suffix}`;
}
