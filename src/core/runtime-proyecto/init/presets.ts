/* [108A-1 Fase 4] Presets de stack agnósticos y contrato de la política generada (sentinel.config.json y lock). Extraído de projectInit.ts. */
import { validateSentinelConfig } from '../config';

export type StackPreset = 'node' | 'rust' | 'python' | 'mixed';

export interface DirectCommands {
  npmScripts: string[];
  npxTools: string[];
  cargoSubcommands: string[];
  tools: string[];
}

export interface PresetDefinition {
  includePatterns: string[];
  excludePatterns: string[];
  directCommands: DirectCommands;
}

/* [108A-1 Fase 4] Presets por stack SIN reglas específicas de producto: solo
 * patrones de archivo y comandos directos del stack. Los presets no declaran
 * reglas (las reglas productivas viven en el núcleo/plugins, una regla un
 * dueño). */
export const STACK_PRESETS: Record<StackPreset, PresetDefinition> = {
  node: {
    includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.css'],
    excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
    directCommands: {
      npmScripts: ['lint', 'test', 'build', 'check'],
      npxTools: ['eslint', 'tsc', 'typescript'],
      cargoSubcommands: [],
      tools: ['git'],
    },
  },
  rust: {
    includePatterns: ['**/*.rs', 'Cargo.toml', 'Cargo.lock'],
    excludePatterns: ['**/target/**', '**/.git/**'],
    directCommands: {
      npmScripts: [],
      npxTools: [],
      cargoSubcommands: ['check', 'test', 'nextest', 'clippy', 'fmt'],
      tools: ['git'],
    },
  },
  python: {
    includePatterns: ['**/*.py'],
    excludePatterns: ['**/__pycache__/**', '**/.venv/**', '**/.git/**'],
    directCommands: {
      npmScripts: [],
      npxTools: [],
      cargoSubcommands: [],
      tools: ['git', 'python', 'pip'],
    },
  },
  mixed: {
    includePatterns: [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.css',
      '**/*.rs', 'Cargo.toml', 'Cargo.lock', '**/*.py',
    ],
    excludePatterns: [
      '**/node_modules/**', '**/dist/**', '**/build/**', '**/target/**',
      '**/__pycache__/**', '**/.venv/**', '**/.git/**',
    ],
    directCommands: {
      npmScripts: ['lint', 'test', 'build', 'check'],
      npxTools: ['eslint', 'tsc', 'typescript'],
      cargoSubcommands: ['check', 'test', 'nextest', 'clippy', 'fmt'],
      tools: ['git', 'python', 'pip'],
    },
  },
};

export const PRESET_NAMES = Object.keys(STACK_PRESETS) as StackPreset[];

export function buildPolicyConfig(preset: StackPreset, primaryBranch: string): Record<string, unknown> {
  return {
    schemaVersion: 2,
    mode: 'enforce',
    project: { primaryBranch },
    guard: { directCommands: STACK_PRESETS[preset].directCommands },
    analyzers: {
      sentinel: {
        enabled: true,
        profile: preset,
        config: {
          includePatterns: STACK_PRESETS[preset].includePatterns,
          excludePatterns: STACK_PRESETS[preset].excludePatterns,
        },
      },
    },
  };
}

export function buildLockConfig(analyzerVersion: string | null): Record<string, unknown> {
  /* [108A-1 Fase 4] El lock se genera desde el runtime; el commit de artifact
   * se fija con la publicación (F8). commit null queda explícito: un lock con
   * pin pendiente nunca debe editarse a mano. */
  return {
    schemaVersion: 1,
    generatedBy: `sentinel init ${analyzerVersion ?? 'unknown'}`,
    analyzers: {
      sentinel: { enabled: true, version: analyzerVersion ?? null, commit: null },
    },
  };
}

/* Valida que una política generada sea aceptada por el schema (fail-closed). */
export function assertGeneratedPolicyValid(content: string): void {
  validateSentinelConfig(JSON.parse(content));
}
