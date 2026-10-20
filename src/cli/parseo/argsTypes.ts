/* [108A-1 Fase 2] Contratos del parser del CLI: tipos de los argumentos y de
 * los resultados, más la versión del esquema JSON. Los módulos args* y
 * commands* los importan desde aquí; args.ts los re-exporta. */
import type { SentinelConfigFile } from '../../core/runtime-proyecto/config';
import type { CoreReportEntry } from '../../core/diagnostico/report';

export type TaskAction = 'claim' | 'start' | 'heartbeat' | 'status' | 'gate' | 'integrate' | 'cleanup' | 'release' | 'recover';

export interface TaskCliArgs {
  command: 'task';
  taskAction: TaskAction;
  taskId?: string;
  workspacePath?: string;
  agent?: string;
  base?: string;
  target?: string;
  primaryBranch?: string;
  worktreePath?: string;
  worktreesRoot?: string;
  envManifestPath?: string;
  summary?: string;
  planReference?: string;
  relatedTaskIds?: string[];
  all?: boolean;
  force?: boolean;
  dryRun?: boolean;
  full?: boolean;
  ci?: boolean;
  allowHeavy?: boolean;
  stagesPath?: string;
  json?: boolean;
  outputPath?: string;
}

export type TaskCliResult = Record<string, unknown>;

export type CliFormat = 'markdown' | 'json';

export type SentinelCliConfigFile = SentinelConfigFile;

export interface ParsedCliArgs {
  command: 'analyze' | 'check' | 'guard' | 'doctor' | 'status' | 'install' | 'update' | 'rollback' | 'uninstall' | 'lease' | 'task' | 'init' | 'migrate' | 'uninit';
  taskAction?: TaskAction;
  agent?: string;
  base?: string;
  worktreePath?: string;
  force?: boolean;
  leaseAction?: 'issue' | 'list' | 'revoke' | 'verify';
  leasePath?: string;
  leaseCommand?: string;
  leasePid?: number;
  leaseTtlMs?: number;
  workspacePath?: string;
  /* [108A-1 F6] `doctor --shims`: lista qué ejecutable gana realmente en PATH. */
  doctorShims?: boolean;
  filePath?: string;
  filesFromPath?: string;
  format: CliFormat;
  outputPath?: string;
  configPath?: string;
  taskId?: string;
  dryRun?: boolean;
  full?: boolean;
  ci?: boolean;
  profile?: string;
  allowHeavy?: boolean;
  json?: boolean;
  stagesPath?: string;
  guardExecutable?: string;
  guardProjectRoot?: string;
  guardArgs?: string[];
  targetRoot?: string;
  sourceRoot?: string;
  runtimeVersion?: string;
  withShims?: boolean;
  withProfiles?: boolean;
  withPath?: boolean;
  withoutPath?: boolean;
  keepRuntime?: boolean;
  /* [108A-1 Fase 4] Opciones de init/migrate/uninit. */
  initPreset?: string;
  initPrimaryBranch?: string;
  initAlias?: string;
  initAnalyzerVersion?: string;
  /* [SQ-4/SQ-5] Límites de analyze. 0 = sin límite. */
  maxFileBytes?: number;
  deadlineMs?: number;
  maxFindings?: number;
}

/* [SQ-4/SQ-5] Qué límites se aplicaron y qué quedó fuera; el reporte lo muestra. */
export interface CliAnalysisLimits {
  maxFileBytes: number;
  archivosOmitidosPorTamano: number;
  deadlineMs: number;
  deadlineAlcanzado: boolean;
  archivosNoAnalizados: number;
  maxFindings: number;
  hallazgosOmitidos: number;
}

export interface CliAnalysisResult {
  entries: CoreReportEntry[];
  totalArchivos: number;
  hasErrors: boolean;
  durationMs: number;
  limites: CliAnalysisLimits;
}

export const SENTINEL_JSON_SCHEMA_VERSION = '1';
