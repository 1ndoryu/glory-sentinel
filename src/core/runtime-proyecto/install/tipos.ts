/* [028A-6] tipos públicos del runtime (opciones, resultados y versiones). Extraído de runtimeInstall.ts. */
import type { PathEntryOptions, PathEntryResult, ProfilePaths, ProfileResult } from '../../shims/interceptorShims';

export interface RuntimeInstallOptions {
  targetRoot?: string;
  sourceRoot?: string;
  version?: string;
  dryRun?: boolean;
  includeDependencies?: boolean;
}

export interface RuntimeInstallResult {
  dryRun: boolean;
  targetRoot: string;
  version: string;
  staged: string;
  installed: string;
  artifactSha256: string;
  previousVersion: string | null;
  changedCurrent: boolean;
  shims: string[];
}

export interface RuntimeRollbackOptions {
  targetRoot?: string;
  version?: string;
  dryRun?: boolean;
}

export interface RuntimeRollbackResult {
  dryRun: boolean;
  targetRoot: string;
  previousVersion: string | null;
  restoredVersion: string | null;
  reason: string;
}

export interface RuntimeVersionInfo {
  version: string;
  artifactSha256: string | null;
  installedAt: string | null;
}

export interface RuntimeStatusResult {
  targetRoot: string;
  versions: RuntimeVersionInfo[];
  activeVersion: string | null;
  activeHash: string | null;
  activeVerified: boolean;
  sourceVersion: string | null;
}

export interface RuntimeUninstallOptions {
  targetRoot?: string;
  dryRun?: boolean;
  /* [028A-6 Fase 5] La retirada de la integración (PATH y perfiles) se puede
   * conservar el runtime versionado con --keep-runtime: se quitan la entrada
   * de PATH, los marcadores de perfiles y el directorio de shims
   * interceptores, pero se conservan versions/current/bin para que el
   * comando global `sentinel` siga resolviendo. Por defecto se retira todo
   * lo administrado (excepto el directorio raíz del runtime). */
  keepRuntime?: boolean;
  /* Inyectables para tests: lectura/escritura del PATH de usuario y perfiles
   * alternativos (defaultProfilePaths() por defecto). */
  pathRead?: PathEntryOptions['read'];
  pathWrite?: PathEntryOptions['write'];
  profiles?: ProfilePaths;
}

export interface RuntimeUninstallResult {
  dryRun: boolean;
  targetRoot: string;
  activeVersion: string | null;
  keepRuntime: boolean;
  pathEntry: PathEntryResult;
  profiles: ProfileResult[];
  removedShimsDir: boolean;
  removedBinDir: boolean;
  removedCurrent: boolean;
  removedVersions: boolean;
  removedTmp: boolean;
  removedRetired: boolean;
  /** Errores de retirada del filesystem (permisos, EPERM, etc.); el resto de
   * pasos ya registra su error en su propio resultado. */
  errors: string[];
}
