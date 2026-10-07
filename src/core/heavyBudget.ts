/* [07AA-6 F2] Tope físico cross-proyecto de validaciones pesadas.
 * Cada ejecución de etapa pesada (cargo check/clippy/test, tsc --noEmit)
 * cuenta en <reportRoot>/runs.jsonl. Como reportRoot es por tarea
 * (.quality-reports/check/<task-id>), tarea nueva = contador nuevo: el tope
 * es por tarea sin caducidad temporal. Agotado el cupo, la etapa NO se
 * ejecuta: veredicto error distinguible (state 'budget-exhausted', exit 2 vía
 * finalDecision) con Next accionable. Ampliación auditable:
 * <projectRoot>/lote-extra.md con un entero (+N). Sin política o política
 * inválida: fail open en observe (solo registra, siempre permite). */
import path from 'node:path';
import { appendFile, mkdir, readFile } from 'node:fs/promises';

export const DEFAULT_BUDGET_LIMIT = 5;
export const BUDGET_RUNS_FILE = 'runs.jsonl';
export const BUDGET_OVERRIDE_FILE = 'lote-extra.md';

const DEFAULT_LIMITS: Record<string, number> = {
  'cargo-check': DEFAULT_BUDGET_LIMIT,
  'cargo-clippy': DEFAULT_BUDGET_LIMIT,
  'cargo-test': DEFAULT_BUDGET_LIMIT,
  'tsc-noemit': DEFAULT_BUDGET_LIMIT,
};

export type BudgetMode = 'observe' | 'enforce';

export interface HeavyBudgets {
  mode: BudgetMode;
  limits: Record<string, number>;
}

function executableBase(value: string): string {
  return path.basename(String(value)).toLowerCase().replace(/\.(cmd|exe|ps1)$/u, '');
}

function firstSubcommand(args: string[]): string | null {
  const found = args.map(String).find(value => !value.startsWith('-'));
  return found ? found.toLowerCase() : null;
}

/* Clasifica (executable, args) en una clase pesada contable o null.
 * Cubre invocación directa (cargo check) y el wrapper declarativo de etapas
 * (pwsh cargo-stage.ps1 <reportPath> <stage> ...). Lo no reconocido no cuenta
 * (fail open): fmt, vitest, node y scripts npm quedan fuera en F2. */
export function classifyHeavy(executable: string, args: string[] = []): string | null {
  const values = args.map(String);
  const stageIndex = values.findIndex(value => path.basename(value).toLowerCase() === 'cargo-stage.ps1');
  if (stageIndex >= 0) {
    const stage = String(values[stageIndex + 2] ?? '').toLowerCase();
    if (stage === 'check' || stage === 'clippy' || stage === 'test') return `cargo-${stage}`;
    return null;
  }
  const base = executableBase(executable);
  if (base === 'cargo') {
    const sub = firstSubcommand(values);
    if (sub === 'check' || sub === 'clippy' || sub === 'test') return `cargo-${sub}`;
    return null;
  }
  if (base === 'tsc' && values.includes('--noEmit')) return 'tsc-noemit';
  return null;
}

export function defaultBudgets(): HeavyBudgets {
  return { mode: 'observe', limits: { ...DEFAULT_LIMITS } };
}

/* La clave `budgets` de sentinel.config.json es opcional y la ignora el
 * lector del guard (readV2GuardPolicy): añadirla no cambia el bloqueo de
 * comandos directos. Forma: { mode?: 'observe'|'enforce',
 * limits?: Record<string, number> }. */
export async function readBudgets(projectRoot: string): Promise<HeavyBudgets> {
  const defaults = defaultBudgets();
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(projectRoot, 'sentinel.config.json'), 'utf8'));
  } catch {
    return defaults;
  }
  const budgets = (raw as { budgets?: unknown })?.budgets;
  if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) return defaults;
  const record = budgets as { mode?: unknown; limits?: unknown };
  const mode: BudgetMode = record.mode === 'enforce' ? 'enforce' : 'observe';
  const limits = { ...defaults.limits };
  if (record.limits && typeof record.limits === 'object' && !Array.isArray(record.limits)) {
    for (const [key, value] of Object.entries(record.limits as Record<string, unknown>)) {
      const amount = Number(value);
      if (Number.isInteger(amount) && amount >= 0 && amount <= 100) limits[key] = amount;
    }
  }
  return { mode, limits };
}

async function readOverrideExtra(projectRoot: string): Promise<number> {
  let content: string;
  try {
    content = await readFile(path.join(projectRoot, BUDGET_OVERRIDE_FILE), 'utf8');
  } catch {
    return 0;
  }
  const match = content.match(/\+?(\d+)/u);
  return match ? Math.max(0, parseInt(match[1], 10)) : 0;
}

export interface BudgetCheck {
  allowed: boolean;
  kind: string;
  used: number;
  limit: number;
  extra: number;
  observed: boolean;
}

/* Cuenta y registra el intento en <reportRoot>/runs.jsonl (una línea JSON por
 * intento, incluidos fallidos y bloqueados). Solo status 'started' consume
 * cupo. Nunca lanza: ante cualquier fallo de E/S permite (fail open). */
export async function checkAndRecordHeavyRun(options: {
  projectRoot: string;
  reportRoot: string;
  kind: string;
  stage: string;
}): Promise<BudgetCheck> {
  const budgets = await readBudgets(options.projectRoot);
  const limit = budgets.limits[options.kind] ?? DEFAULT_BUDGET_LIMIT;
  const extra = await readOverrideExtra(options.projectRoot);
  const runsPath = path.join(options.reportRoot, BUDGET_RUNS_FILE);
  let used = 0;
  try {
    const raw = await readFile(runsPath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as { kind?: unknown; status?: unknown };
        if (record?.kind === options.kind && record?.status === 'started') used += 1;
      } catch {
        /* Línea corrupta: se ignora sin romper el gate. */
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') return allowed(true);
  }
  const exhausted = used >= limit + extra;
  const observed = budgets.mode === 'observe';
  const record = {
    ts: new Date().toISOString(),
    kind: options.kind,
    stage: options.stage,
    status: exhausted && !observed ? 'blocked' : 'started',
    used,
    limit,
    extra,
    mode: budgets.mode,
  };
  try {
    await mkdir(options.reportRoot, { recursive: true });
    await appendFile(runsPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    return allowed(true);
  }
  if (exhausted && !observed) {
    return { allowed: false, kind: options.kind, used, limit, extra, observed };
  }
  if (exhausted && observed) {
    console.warn(`[sentinel-budget] ${options.kind} supera el tope (${used}/${limit + extra}) en modo observe: la etapa corre igual; F7 lo hará cumplir.`);
  }
  return { allowed: true, kind: options.kind, used, limit, extra, observed };

  function allowed(fallback: boolean): BudgetCheck {
    return { allowed: fallback, kind: options.kind, used, limit, extra, observed: true };
  }
}
