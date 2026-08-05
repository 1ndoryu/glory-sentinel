/* [028A-6 Fase 1] Guard de comandos directos del gate agnóstico.
 * Port de scripts/quality/quality-command-guard.mjs: decide si una invocación
 * directa (npm/npx/cargo/tool) debe bloquearse (exit 78) u observarse según
 * la política v2 (sentinel.config.json) o los defaults genéricos. Cada
 * proyecto declara su guard en su política; el core no conoce scripts de
 * wandori.us. */
import path from 'node:path';
import { lstatSync, readFileSync } from 'node:fs';
import { decisionForGuard } from './policyDecision';
import { findQualityRoot, hasQualityMarker } from './scheduler';
import { LEASE_ENV_VAR, verifyLease } from './lease';

export const QUALITY_GUARD_EXIT_CODE = 78;

/* Defaults genéricos de herramientas que deben entrar por el gate. La
 * política v2 de un proyecto puede sobrescribirlos. */
export const BLOCKED_NPM_SCRIPTS = Object.freeze([
  '__sentinel_guard_probe__',
  'test', 'test:changed', 'test:full', 'test:file', 'test:watch',
  'type-check', 'lint', 'check', 'check:back', 'check:front',
  'fmt', 'fmt:check', 'build',
]);
export const BLOCKED_TOOLS = Object.freeze(['vitest', 'tsc', 'eslint', 'prettier', 'rustfmt']);
export const BLOCKED_CARGO_COMMANDS = Object.freeze(['check', 'clippy', 'test', 'bench', 'fmt']);

function normalizeExecutable(value = ''): string {
  return path.basename(String(value)).toLowerCase().replace(/\.(cmd|exe)$/u, '');
}

function firstNonOption(args: string[] = []): string | undefined {
  return args.find(value => !String(value).startsWith('-'));
}

export interface GuardPolicy {
  status: 'no-policy' | 'legacy-v1' | 'policy' | 'invalid-policy';
  mode?: string;
  npmScripts?: Set<string>;
  npxTools?: Set<string>;
  cargoSubcommands?: Set<string>;
  tools?: Set<string>;
}

/* [028A-6] La política v2 es sentinel.config.json (schemaVersion 2 con
 * guard.directCommands); un archivo v1 de reglas cae a legacy-v1 y conserva
 * los defaults. Los symlinks/junctions no se siguen: configuración externa no
 * se carga desde los shims. */
export function readV2GuardPolicy(root: string): GuardPolicy {
  const policyPath = path.join(root, 'sentinel.config.json');
  let metadata: ReturnType<typeof lstatSync>;
  try {
    metadata = lstatSync(policyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { status: 'no-policy' };
    return { status: 'invalid-policy' };
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) return { status: 'invalid-policy' };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch {
    return { status: 'invalid-policy' };
  }
  const parsed = raw as { schemaVersion?: unknown; mode?: unknown; guard?: { directCommands?: Record<string, unknown> } };
  if (parsed?.schemaVersion !== 2) return { status: 'legacy-v1' };
  const mode = parsed.mode;
  const directCommands = parsed.guard?.directCommands;
  if (!['enforce', 'observe', 'pass-through'].includes(String(mode)) || !directCommands || typeof directCommands !== 'object') {
    return { status: 'invalid-policy' };
  }
  const lists = ['npmScripts', 'npxTools', 'cargoSubcommands', 'tools'];
  if (!lists.every(key => Array.isArray(directCommands[key]) && (directCommands[key] as unknown[]).every(value => typeof value === 'string'))) {
    return { status: 'invalid-policy' };
  }
  return {
    status: 'policy',
    mode: String(mode),
    npmScripts: new Set(directCommands.npmScripts as string[]),
    npxTools: new Set((directCommands.npxTools as string[]).map(normalizeExecutable)),
    cargoSubcommands: new Set((directCommands.cargoSubcommands as string[]).map(value => value.toLowerCase())),
    tools: new Set((directCommands.tools as string[]).map(normalizeExecutable)),
  };
}

function matchesPolicyName(value: string, patterns: Set<string>): boolean {
  if (patterns.has(value)) return true;
  return [...patterns].some(pattern => pattern.includes('*') && new RegExp(
    `^${pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`,
    'u',
  ).test(value));
}

function npmScript(args: string[] = [], allowedScripts: Set<string>): string | null {
  const values = args.map(String);
  const runIndex = values.findIndex(value => value === 'run' || value === 'run-script');
  if (runIndex >= 0) return values[runIndex + 1] ?? null;
  const direct = values.find(value => matchesPolicyName(value, allowedScripts));
  return direct ?? null;
}

function npxTool(args: string[] = []): string | null {
  const values = args.map(String);
  const index = values.findIndex(value => !value.startsWith('-'));
  return index >= 0 ? normalizeExecutable(values[index]) : null;
}

export interface GuardInspectOptions {
  executable?: string;
  args?: string[];
  cwd?: string;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
}

export interface GuardDecision {
  blocked: boolean;
  root: string | null;
  policyStatus?: string;
  mode?: string;
  action?: string;
  observed?: boolean | string;
  reason?: string;
  category?: string | null;
  command?: string;
  exitCode?: number;
  /* [028A-6 Fase 2] El lease firmado eximió la invocación: expone su id para
   * que el JSON del guard muestre la vía sancionada usada. */
  leaseId?: string | null;
  leaseVerified?: boolean;
}

export async function inspectDirectCommand(options: GuardInspectOptions = {}): Promise<GuardDecision> {
  const { executable = '', args = [], cwd = process.cwd(), projectRoot, env = process.env } = options;
  const leasePath = env[LEASE_ENV_VAR];
  /* [297A-58] Token legacy: las etapas internas del gate anterior se eximen
   * con un valor aleatorio por ejecución. [028A-6 Fase 2] Con lease presente
   * la exención pasa por el lease firmado (más abajo); el token solo aplica
   * cuando no hay lease (migración del orquestador anterior). */
  if (!leasePath && env.GLORY_QUALITY_GATE_TOKEN) return { blocked: false, root: null };
  const candidate = await findQualityRoot(projectRoot ? path.resolve(projectRoot) : cwd);
  /* [028A-6] El fallback de findQualityRoot es el startPath; sin marcador
   * declarativo real no hay política que aplicar y el comando pasa. */
  if (!candidate || !hasQualityMarker(candidate)) return { blocked: false, root: null };
  const root = candidate;

  const command = normalizeExecutable(executable);
  const values = args.map(String);
  const policy = readV2GuardPolicy(root);
  const legacyFallback = policy.status === 'legacy-v1';
  const npmScripts = policy.status === 'policy' || legacyFallback ? (policy.npmScripts ?? new Set(BLOCKED_NPM_SCRIPTS)) : new Set(BLOCKED_NPM_SCRIPTS);
  const npxTools = policy.status === 'policy' || legacyFallback ? (policy.npxTools ?? new Set(BLOCKED_TOOLS)) : new Set(BLOCKED_TOOLS);
  const cargoCommands = policy.status === 'policy' || legacyFallback ? (policy.cargoSubcommands ?? new Set(BLOCKED_CARGO_COMMANDS)) : new Set(BLOCKED_CARGO_COMMANDS);
  const tools = policy.status === 'policy' || legacyFallback ? (policy.tools ?? new Set(BLOCKED_TOOLS)) : new Set(BLOCKED_TOOLS);
  let reason: string | null = null;
  let category: string | null = null;

  if (command === 'npm') {
    const script = npmScript(values, npmScripts);
    if (script && matchesPolicyName(script, npmScripts)) {
      reason = `npm ${script}`;
      category = 'script';
    } else {
      const execIndex = values.findIndex(value => value === 'exec');
      const tool = execIndex >= 0 ? npxTool(values.slice(execIndex + 1)) : null;
      if (tool && matchesPolicyName(tool, npxTools)) {
        reason = `npm exec ${tool}`;
        category = 'tool';
      }
    }
  } else if (command === 'npx') {
    const tool = npxTool(values);
    if (tool && matchesPolicyName(tool, npxTools)) {
      reason = `npx ${tool}`;
      category = 'tool';
    }
  } else if (matchesPolicyName(command, tools)) {
    reason = command;
    category = 'tool';
  } else if (command === 'cargo') {
    const cargoCommand = firstNonOption(values)?.toLowerCase();
    if (cargoCommand && matchesPolicyName(cargoCommand, cargoCommands)) {
      reason = `cargo ${cargoCommand}`;
      category = 'cargo';
    }
  }

  const discovered = policy.status === 'policy'
    ? { status: 'policy', policy: { mode: policy.mode } }
    : { status: policy.status };
  const baseDecision = decisionForGuard(discovered, reason);
  const decision = policy.status === 'invalid-policy' && reason
    ? { ...baseDecision, blocked: true, observed: false, reason }
    : baseDecision;
  if (!reason || (!decision.blocked && !decision.observed)) {
    return { ...decision, blocked: false, root, policyStatus: policy.status };
  }
  /* [028A-6 Fase 2] Lease efímero firmado: exime SOLO la invocación que iba
   * a bloquearse, si la verificación valida (firma, proyecto, expiración y
   * PID descendiente del emisor). La exención queda auditada. Un lease
   * inválido nunca exime: se devuelve el bloqueo normal. La verificación no
   * corre para comandos que la política ya deja pasar, así la vía caliente
   * no paga resolución de procesos. */
  if (leasePath && decision.blocked) {
    const verification = await verifyLease({
      leasePath,
      projectRoot: root,
      pid: process.pid,
      command: normalizeExecutable(executable),
    });
    if (verification.valid) {
      return {
        ...decision,
        blocked: false,
        observed: false,
        root,
        policyStatus: policy.status,
        leaseId: verification.lease?.id ?? null,
        leaseVerified: true,
      };
    }
  }
  return {
    ...decision,
    category,
    command: reason,
    root,
    exitCode: decision.blocked ? QUALITY_GUARD_EXIT_CODE : undefined,
    policyStatus: policy.status,
  };
}

export function formatBlockMessage(decision: GuardDecision): string {
  return [
    '[glory-quality] BLOQUEADO: esta validación directa no está permitida.',
    `  Comando detectado: ${String(decision.command)}`,
    '  Ejecuta el gate del proyecto para usar alcance incremental y límites:',
    '  sentinel check <TareaId>',
    '  El gate decide type-check/tests/build según la tarea y el modo CI.',
  ].join('\n');
}
