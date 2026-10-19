/* [028A-6 Fase 1] Generación de shims interceptores del runtime global de
 * Sentinel y gestión de perfiles con backup. El runtime es la única fuente
 * de los wrappers: en lugar de mantener npm.cmd/npx.cmd/cargo.cmd/node.cmd
 * y los guards de bash/PowerShell duplicados en cada proyecto, se generan
 * desde el core apuntando al CLI instalado (<targetRoot>/current.js guard).
 * La resolución del ejecutable real es sin recursión (env var primero,
 * `where`/`type -P` excluyendo el propio shim) y preserva argumentos,
 * exit codes y redirecciones. Los perfiles se dot-sourcean solo de forma
 * explícita (--with-profiles) y SIEMPRE con backup previo. */
import path from 'node:path';

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
