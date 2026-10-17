import { ConfigReglaUsuario, obtenerIdsReglas } from '../config/ruleRegistry';
import { CoreAnalysisConfig } from './types';
import { isSafeBranch } from './branchValidation';
import { HEAVY_BUDGET_CLASSES } from './heavyBudget';

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
  project?: {
    /** Rama de integración del proyecto; no se asume que se llame `main`. */
    primaryBranch?: string;
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
  /* [07AA-10] Política del tope físico F2 (la consume readBudgets, la ignora
   * el lector del guard). El analizador la admite como clave conocida con
   * validación estricta de forma para no reintroducir el fallo del piloto. */
  budgets?: { mode?: string; limits?: Record<string, number> };
}

export const DEFAULT_INCLUDE_PATTERNS = [
  '**/*.php',
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.mjs',
  /* [17AA-2] `.cjs` es JavaScript (CommonJS) para todo el núcleo —`language.ts`
   * lo mapea a `.js`, `EXTENSIONES_CODIGO` lo incluye—, pero no estaba en la
   * lista por defecto, así que un `.cjs` no entraba al análisis nunca. */
  '**/*.cjs',
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
];

const CONFIG_KEYS = new Set(['includePatterns', 'excludePatterns', 'directoryExceptions', 'rules', 'portableBoundaries', 'project', 'schemaVersion', 'mode', 'gate', 'guard', 'runtime', 'analyzers', 'budgets']);
const PORTABLE_BOUNDARY_KEYS = new Set(['dom', 'window', 'services', 'loggerModules', 'tooling']);
const RULE_KEYS = new Set(['habilitada', 'severidad']);
const VALID_SEVERITIES = new Set(['error', 'warning', 'information', 'hint']);


export function isSafePrimaryBranch(value: string): boolean {
  return isSafeBranch(value);
}

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
  /* [07AA-10] 'budgets' es clave conocida con forma estricta (paridad con
   * readBudgets): mode observe|enforce, limits con clases conocidas y
   * enteros 0..100. Un typo en la clase fallaría abierto en silencio si se
   * ignorase; por eso se rechaza con mensaje accionable. */
  if (config.budgets !== undefined) {
    if (!config.budgets || typeof config.budgets !== 'object' || Array.isArray(config.budgets)) {
      throw new Error("sentinel.config.json: 'budgets' debe ser un objeto");
    }
    const budgets = config.budgets as { mode?: unknown; limits?: unknown };
    if (budgets.mode !== undefined && budgets.mode !== 'observe' && budgets.mode !== 'enforce') {
      throw new Error(`sentinel.config.json: 'budgets.mode' inválido (${String(budgets.mode)})`);
    }
    if (budgets.limits !== undefined) {
      if (!budgets.limits || typeof budgets.limits !== 'object' || Array.isArray(budgets.limits)) {
        throw new Error("sentinel.config.json: 'budgets.limits' debe ser un objeto");
      }
      for (const [kind, amount] of Object.entries(budgets.limits as Record<string, unknown>)) {
        if (!(HEAVY_BUDGET_CLASSES as readonly string[]).includes(kind)) {
          throw new Error(`sentinel.config.json: clase de límite desconocida '${kind}' (válidas: ${HEAVY_BUDGET_CLASSES.join(', ')})`);
        }
        if (!Number.isInteger(amount) || (amount as number) < 0 || (amount as number) > 100) {
          throw new Error(`sentinel.config.json: límite inválido para '${kind}' (entero 0..100)`);
        }
      }
    }
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

  if (config.project !== undefined) {
    if (!config.project || typeof config.project !== 'object' || Array.isArray(config.project)) {
      throw new Error("sentinel.config.json: 'project' debe ser un objeto");
    }
    const project = config.project as Record<string, unknown>;
    for (const key of Object.keys(project)) {
      if (key !== 'primaryBranch') {
        throw new Error(`sentinel.config.json: clave desconocida 'project.${key}'`);
      }
    }
    if (typeof project.primaryBranch !== 'string' || !isSafePrimaryBranch(project.primaryBranch)) {
      throw new Error("sentinel.config.json: 'project.primaryBranch' debe ser un nombre de rama Git válido");
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
/* [17AA-4] `includePatterns` se completa con los defaults, no los reemplaza.
 *
 * Antes era `?? DEFAULT_INCLUDE_PATTERNS`: una ficha que declaraba sus propios
 * patrones congelaba una copia de los defaults de su fecha, asi que cuando el
 * default gano el patron de `.mjs` (11-oct) las 11 fichas con patrones propios
 * siguieron sin analizarlo y el arreglo solo valia para un proyecto.
 *
 * Una union a secas tampoco vale, y se midio: WANDORIUS, RESTAURANTE, NAKOMI,
 * PROYECTO TASKS y gloryapi acotan a proposito a `frontend/`, `scripts/`,
 * `client/`… para no analizar el resto del repo, y anadir el patron global de
 * `.ts` anula ese acotado (WANDORIUS paso de 0 a 141 hallazgos). Y los proyectos
 * puramente Rust (limpiador-pc, glory-agent, GLORYPORT, glory-pulse) no
 * declaran ni un patron web: meterles JS no tiene sentido.
 *
 * De ahi la regla: **los defaults rellenan las extensiones que la ficha olvido,
 * dentro de los ambitos que la ficha eligio**. El prefijo de directorio de cada
 * familia sale de los patrones que la ficha ya declara para esa familia; si no
 * declara ninguno, la familia entera esta fuera de su alcance y no se toca.
 * Para quitar algo que si este en los defaults queda `excludePatterns`, que ya
 * existia. */
const FAMILIA_DE_EXTENSION: Record<string, string> = {
  ts: 'web', tsx: 'web', js: 'web', jsx: 'web', mjs: 'web', cjs: 'web',
  css: 'web', scss: 'web', less: 'web', php: 'web',
  rs: 'rust', toml: 'rust',
  py: 'python',
};

function extensionDe(patron: string): string | null {
  const punto = patron.lastIndexOf('.');
  return punto === -1 ? null : patron.slice(punto + 1);
}

/* El ambito de un patron es su directorio. Hay que quitar el comodin de
 * directorio antes de mirarlo: en `frontend/**` + `/*.ts` el ultimo separador
 * esta dentro del comodin, y cortar ahi daria `frontend/**` + `**` + `/*.mjs`,
 * que no acota nada. El comodin solo, o su ausencia, significan lo mismo: la
 * ficha no acota y el patron sale global. */
const COMODIN_DIRECTORIO = '**' + '/';
function prefijoDe(patron: string): string {
  const barra = patron.lastIndexOf('/');
  if (barra === -1) { return ''; }
  const prefijo = patron.slice(0, barra + 1);
  return prefijo.endsWith(COMODIN_DIRECTORIO)
    ? prefijo.slice(0, -COMODIN_DIRECTORIO.length)
    : prefijo;
}

function conPrefijo(prefijo: string, ext: string): string {
  return `${prefijo}**/*.${ext}`;
}

export function patronesDeInclusion(declarados: string[] | undefined): string[] {
  if (!declarados || declarados.length === 0) {
    return DEFAULT_INCLUDE_PATTERNS;
  }
  const propios = new Set(declarados);
  const faltan = DEFAULT_INCLUDE_PATTERNS.filter(patron => !propios.has(patron));
  if (faltan.length === 0) {
    return declarados;
  }

  const prefijosPorFamilia = new Map<string, Set<string>>();
  for (const patron of declarados) {
    const ext = extensionDe(patron);
    const familia = ext ? FAMILIA_DE_EXTENSION[ext] : undefined;
    if (!familia) { continue; }
    const prefijo = prefijoDe(patron);
    if (!prefijosPorFamilia.has(familia)) { prefijosPorFamilia.set(familia, new Set()); }
    prefijosPorFamilia.get(familia)!.add(prefijo);
  }

  const anadidos: string[] = [];
  for (const patron of faltan) {
    const ext = extensionDe(patron);
    const familia = ext ? FAMILIA_DE_EXTENSION[ext] : undefined;
    const prefijos = familia ? prefijosPorFamilia.get(familia) : undefined;
    if (!ext || !prefijos || prefijos.size === 0) { continue; }
    for (const prefijo of prefijos) { anadidos.push(conPrefijo(prefijo, ext)); }
  }
  return [...new Set([...declarados, ...anadidos])];
}

/* [105A-1] Defaults compartidos por CLI y LSP para que ambas superficies consuman
 * el mismo motor sin duplicar contratos de configuracion. */
export function buildCoreConfig(config: SentinelConfigFile): CoreAnalysisConfig {
  const analyzerConfig = analyzerSubConfig(config);
  return {
    enabled: true,
    includePatterns: patronesDeInclusion(analyzerConfig.includePatterns),
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
