import { ConfigReglaUsuario } from '../config/ruleRegistry';
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
