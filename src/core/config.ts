import { ConfigReglaUsuario, obtenerIdsReglas } from '../config/ruleRegistry';
import { CoreAnalysisConfig } from './types';

export interface SentinelConfigFile {
  includePatterns?: string[];
  excludePatterns?: string[];
  directoryExceptions?: string[];
  rules?: Record<string, ConfigReglaUsuario>;
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

const CONFIG_KEYS = new Set(['includePatterns', 'excludePatterns', 'directoryExceptions', 'rules']);
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

  for (const key of ['includePatterns', 'excludePatterns', 'directoryExceptions'] as const) {
    if (config[key] !== undefined) {
      assertStringArray(config[key], key);
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

/* [105A-1] Defaults compartidos por CLI y LSP para que ambas superficies consuman
 * el mismo motor sin duplicar contratos de configuracion. */
export function buildCoreConfig(config: SentinelConfigFile): CoreAnalysisConfig {
  return {
    enabled: true,
    includePatterns: config.includePatterns ?? DEFAULT_INCLUDE_PATTERNS,
    excludePatterns: config.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS,
    directoryExceptions: config.directoryExceptions ?? [],
    ruleOverrides: Object.fromEntries(
      Object.entries(config.rules ?? {}).map(([ruleId, override]) => [ruleId, {
        enabled: override.habilitada,
        severity: override.severidad,
      }])
    ),
    useConfiguredRuleProvider: false,
  };
}
