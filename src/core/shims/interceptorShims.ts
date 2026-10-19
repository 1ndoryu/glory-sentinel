/* [028A-6] Fachada del módulo de interceptores de shims. La lógica vive en
 * interceptorShims{Base,Generadores,PowerShell,Perfiles,Path}.ts; los consumidores
 * importan desde aquí. */
export {
  PROFILE_MARKER_START,
  PROFILE_MARKER_END,
  LEGACY_MARKERS,
  assertSafeRuntimePath,
  defaultProfilePaths,
} from './interceptorShimsBase';
export type {
  ProfileKind,
  ProfilePaths,
  InstallProfilesOptions,
  ProfileResult,
  InstallProfilesResult,
} from './interceptorShimsBase';
export { generateBashGuard, generateCmdShim, SHIM_COVERAGE } from './interceptorShimsGeneradores';
export { generatePowerShellGuard } from './interceptorShimsPowerShell';
export {
  writeInterceptorShims,
  installProfiles,
  uninstallProfiles,
  formatProfilesResult,
} from './interceptorShimsPerfiles';
export {
  shimsPathFor,
  runtimePathEntries,
  installPathEntry,
  uninstallPathEntry,
  formatPathEntryResult,
} from './interceptorShimsPath';
export type { PathEntryOptions, PathEntryResult } from './interceptorShimsPath';
