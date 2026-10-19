/* [028A-6 Fase 1] Runtime global versionado de Sentinel: install/update/
 * rollback siguiendo el contrato politica-actualizacion-rollback-sentinel-
 * 2026-08-04.md. El alias activo es current.json (marcador atómico con
 * writeAtomic, sin junctions: portable y seguro en Windows); los shims del
 * CLI resuelven a través de él. Nunca toca perfiles ni PATH: las operaciones
 * son explícitas, con --dry-run y verificación del hash del artefacto.
 * Fachada: la lógica vive en install/; este archivo conserva la API pública
 * (mismos exports y mismo path). */

export type { RuntimeInstallOptions, RuntimeInstallResult, RuntimeRollbackOptions, RuntimeRollbackResult, RuntimeVersionInfo, RuntimeStatusResult, RuntimeUninstallOptions, RuntimeUninstallResult } from './install/tipos';
export { resolveRuntimeRoot, resolveSourceRoot } from './install/rutas';
export { hashArtifact } from './install/artefacto';
export { listVersions } from './install/version';
export { installRuntime } from './install/instalar';
export { rollbackRuntime } from './install/rollback';
export { uninstallRuntime } from './install/desinstalar';
export { runtimeStatus, formatRuntimeResult } from './install/estado';
