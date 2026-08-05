import { ConfigReglaUsuario, obtenerIdsReglas } from '../config/ruleRegistry';
import { CoreAnalysisConfig } from './types';

export interface SentinelConfigFile {
  includePatterns?: string[];
  excludePatterns?: string[];
  directoryExceptions?: string[];
  rules?: Record<string, ConfigReglaUsuario>;
  portableBoundaries?: {
    dom?: string[];
    window?: string[];
    services?: string[];
    loggerModules?: string[];
  };
  /* [028A-6 Fase 3] Envelope de política v2: el mismo sentinel.config.json
   * declara la política del guard (schemaVersion 2 con mode/gate/guard/
   * runtime/analyzers) y, dentro de analyzers.sentinel.config, las reglas
   * del analizador. readV2GuardPolicy consume la política; buildCoreConfig
   * extrae la subconfig del analizador. La raíz v1 (reglas sueltas) sigue
   * siendo válida como legacy. */
  schemaVersion?: number;
  mode?: string;
  gate?: { command?: string[]; taskIdRequired?: boolean };
  guard?: { directCommands?: Record<string, string[]> };
  runtime?: { minimumVersion?: string; protocolVersion?: number; lockFile?: string };
  analyzers?: { sentinel?: { enabled?: boolean; profile?: string; config?: SentinelConfigFile | string } };
}

export const DEFAULT_INCLUDE_PATTERNS = [
  '**/*.php',
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.css',
  '**/*.scss',
  '**/*.less',
  '**/*.rs',
];

export const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/vendor/**',
  '**/dist/**',
  '**/_generated/**',
  '**/out/**',
  '**/.vitepress/cache/**',
  '**/build/**',
  '**/.agent/**',
  '**/target/**',
  '**/scripts/**',
];

const CONFIG_KEYS = new Set(['includePatterns', 'excludePatterns', 'directoryExceptions', 'rules', 'portableBoundaries', 'schemaVersion', 'mode', 'gate', 'guard', 'runtime', 'analyzers']);
const PORTABLE_BOUNDARY_KEYS = new Set(['dom', 'window', 'services', 'loggerModules']);
const RULE_KEYS = new Set(['habilitada', 'severidad']);
const VALID_SEVERITIES = new Set(['error', 'warning', 'information', 'hint']);

function assertStringArray(value: unknown, key: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`sentinel.config.json: '${key}' debe ser string[]`);
  }
}

export function validateSentinelConfig(value: unknown): asserts value is SentinelConfigFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('sentinel.config.json: la raiz debe ser un objeto');
  }

  const config = value as Record<string, unknown>;
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(`sentinel.config.json: clave desconocida '${key}'`);
    }
  }

  /* [028A-6 Fase 3] Validación mínima del envelope v2 cuando está presente:
   * no se duplica readV2GuardPolicy (que lo valida exhaustivamente), pero un
   * schemaVersion distinto de 2 o un mode inválido deben fallar cerrado. */
  if (config.schemaVersion !== undefined && config.schemaVersion !== 2) {
    throw new Error(`sentinel.config.json: schemaVersion inválido (${String(config.schemaVersion)})`);
  }
  if (config.mode !== undefined && !['enforce', 'observe', 'pass-through'].includes(String(config.mode))) {
    throw new Error(`sentinel.config.json: mode inválido (${String(config.mode)})`);
  }
  if (config.gate !== undefined && (!config.gate || typeof config.gate !== 'object' || Array.isArray(config.gate))) {
    throw new Error("sentinel.config.json: 'gate' debe ser un objeto");
  }
  if (config.guard !== undefined && (!config.guard || typeof config.guard !== 'object' || Array.isArray(config.guard))) {
    throw new Error("sentinel.config.json: 'guard' debe ser un objeto");
  }
  if (config.runtime !== undefined && (!config.runtime || typeof config.runtime !== 'object' || Array.isArray(config.runtime))) {
    throw new Error("sentinel.config.json: 'runtime' debe ser un objeto");
  }
  if (config.analyzers !== undefined && (!config.analyzers || typeof config.analyzers !== 'object' || Array.isArray(config.analyzers))) {
    throw new Error("sentinel.config.json: 'analyzers' debe ser un objeto");
  }
  /* [028A-6 Fase 3] En v2, las reglas del analizador viven en
   * analyzers.sentinel.config (objeto); se validan con el mismo contrato de
   * reglas. Una config string (ruta) se resuelve al leer el archivo. */
  const analyzerSentinel = (config.analyzers as { sentinel?: { config?: unknown } } | undefined)?.sentinel;
  if (analyzerSentinel?.config !== undefined && typeof analyzerSentinel.config === 'object' && !Array.isArray(analyzerSentinel.config)) {
    validateSentinelConfig(analyzerSentinel.config);
  }

  for (const key of ['includePatterns', 'excludePatterns', 'directoryExceptions'] as const) {
    if (config[key] !== undefined) {
      assertStringArray(config[key], key);
    }
  }

  if (config.portableBoundaries !== undefined) {
    if (!config.portableBoundaries || typeof config.portableBoundaries !== 'object' || Array.isArray(config.portableBoundaries)) {
      throw new Error("sentinel.config.json: 'portableBoundaries' debe ser un objeto");
    }
    const boundaries = config.portableBoundaries as Record<string, unknown>;
    for (const key of Object.keys(boundaries)) {
      if (!PORTABLE_BOUNDARY_KEYS.has(key)) {
        throw new Error(`sentinel.config.json: clave desconocida 'portableBoundaries.${key}'`);
      }
      assertStringArray(boundaries[key], `portableBoundaries.${key}`);
    }
  }

  if (config.rules === undefined) {
    return;
  }
  if (!config.rules || typeof config.rules !== 'object' || Array.isArray(config.rules)) {
    throw new Error("sentinel.config.json: 'rules' debe ser un objeto");
  }

  const knownRuleIds = obtenerIdsReglas();
  for (const [ruleId, rawOverride] of Object.entries(config.rules as Record<string, unknown>)) {
    if (!knownRuleIds.has(ruleId)) {
      throw new Error(`sentinel.config.json: regla desconocida '${ruleId}'`);
    }
    if (!rawOverride || typeof rawOverride !== 'object' || Array.isArray(rawOverride)) {
      throw new Error(`sentinel.config.json: override invalido para '${ruleId}'`);
    }
    const override = rawOverride as Record<string, unknown>;
    for (const key of Object.keys(override)) {
      if (!RULE_KEYS.has(key)) {
        throw new Error(`sentinel.config.json: clave desconocida '${ruleId}.${key}'`);
      }
    }
    if (override.habilitada !== undefined && typeof override.habilitada !== 'boolean') {
      throw new Error(`sentinel.config.json: '${ruleId}.habilitada' debe ser boolean`);
    }
    if (override.severidad !== undefined &&
        (typeof override.severidad !== 'string' || !VALID_SEVERITIES.has(override.severidad))) {
      throw new Error(`sentinel.config.json: severidad invalida para '${ruleId}'`);
    }
  }
}

/* [028A-6 Fase 3] En v2, la subconfig del analizador es analyzers.sentinel.config;
 * en v1, las reglas viven sueltas en la raíz. buildCoreConfig normaliza ambos
 * para que el motor no conozca la diferencia. */
export function analyzerSubConfig(config: SentinelConfigFile): SentinelConfigFile {
  if (config.schemaVersion === 2) {
    const inner = config.analyzers?.sentinel?.config;
    return inner && typeof inner === 'object' && !Array.isArray(inner) ? inner : {};
  }
  return config;
}

/* [105A-1] Defaults compartidos por CLI y LSP para que ambas superficies consuman
 * el mismo motor sin duplicar contratos de configuracion. */
export function buildCoreConfig(config: SentinelConfigFile): CoreAnalysisConfig {
  const analyzerConfig = analyzerSubConfig(config);
  return {
    enabled: true,
    includePatterns: analyzerConfig.includePatterns ?? DEFAULT_INCLUDE_PATTERNS,
    excludePatterns: analyzerConfig.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS,
    directoryExceptions: analyzerConfig.directoryExceptions ?? [],
    ruleOverrides: Object.fromEntries(
      Object.entries(analyzerConfig.rules ?? {}).map(([ruleId, override]) => [ruleId, {
        enabled: override.habilitada,
        severity: override.severidad,
      }])
    ),
    useConfiguredRuleProvider: false,
    portableBoundaries: analyzerConfig.portableBoundaries,
  };
}
