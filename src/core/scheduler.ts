/* [028A-6 Fase 1] Scheduler del gate agnóstico: cooldown de full y lock de
 * ejecuciones pesadas. Extraído de scripts/quality/heavy-run-guard.mjs de
 * wandori.us; el marcador de raíz es la política v2 (sentinel.config.json)
 * con fallback v1 (quality.config.json) para la migración. El wrapper que
 * interceptaba `cargo` (--execute-cargo) queda en el orquestador: es
 * integración de migración, no capacidad del core. */
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_COOLDOWN_MS = 3 * 60 * 60 * 1000;
const DEFAULT_TARGET_BASE = process.platform === 'win32'
  ? 'C:\\tmp\\glory-target'
  : path.join(os.tmpdir(), 'glory-target');

export interface HeavyRunOptions {
  projectRoot: string;
  targetBase?: string;
  mode?: string;
  taskId?: string | null;
  command?: string;
  allowHeavy?: boolean;
  now?: number;
}

export interface HeavyRunDecision {
  allowed: boolean;
  reason?: 'cooldown' | 'active';
  cooldownMs?: number;
  remainingMs?: number;
  override?: boolean;
  message?: string;
  nextAllowedAt?: string;
  lastHeavyAt?: string;
}

export interface HeavyRunLease extends HeavyRunDecision {
  allowed: true;
  token: string;
  release(options?: { status?: string }): Promise<void>;
}

export interface HeavyState {
  version: number;
  projects: Record<string, {
    projectRoot: string;
    lastHeavyAt: number;
    lastStatus?: string;
    taskId?: string | null;
    command?: string;
  }>;
}

interface ActiveLock {
  pid: number;
  token: string;
}

function normalizeRoot(value: string): string {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase();
}

function projectKey(projectRoot: string): string {
  return crypto.createHash('sha256').update(normalizeRoot(projectRoot)).digest('hex').slice(0, 16);
}

export function resolveTargetBase(): string {
  return path.resolve(process.env.CARGO_TARGET_DIR_BASE || DEFAULT_TARGET_BASE);
}

export function resolveGuardRoot(targetBase: string = resolveTargetBase()): string {
  return path.join(path.dirname(path.resolve(targetBase)), 'glory-quality-guard');
}

function statePath(targetBase: string): string {
  return path.join(resolveGuardRoot(targetBase), 'state.json');
}

function activePath(targetBase: string): string {
  return path.join(resolveGuardRoot(targetBase), 'active.json');
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readCooldownMs(config: Record<string, unknown> = {}): number {
  const minutes = Number((config.heavyRun as { cooldownMinutes?: unknown } | undefined)?.cooldownMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) return DEFAULT_COOLDOWN_MS;
  return minutes * 60 * 1000;
}

/* [028A-6] Fuente de transición: la política v2 (sentinel.config.json) manda;
 * quality.config.json es el fallback del orquestador en migración. Durante la
 * migración se fusiona la clave heavyRun (v2 ?? v1): un cooldown v1
 * personalizado no se pierde cuando existe un archivo v2 sin heavyRun. */
async function readProjectConfig(projectRoot: string): Promise<Record<string, unknown>> {
  const v2 = await readJson<Record<string, unknown> | null>(path.join(projectRoot, 'sentinel.config.json'), null);
  const v1 = await readJson<Record<string, unknown>>(path.join(projectRoot, 'quality.config.json'), {});
  if (!v2) return v1;
  if (v2.heavyRun === undefined && v1.heavyRun !== undefined) {
    return { ...v2, heavyRun: v1.heavyRun };
  }
  return v2;
}

/* [028A-6] Verifica que una raíz tenga un marcador declarativo real
 * (sentinel.config.json o quality.config.json como archivo regular, sin
 * symlinks). findQualityRoot devuelve el startPath como fallback cuando no
 * hay marcador; esta función permite distinguir "raíz encontrada por
 * marcador" de "fallback", para que doctor/guard no mientan sobre la raíz. */
export function hasQualityMarker(candidate: string): boolean {
  for (const marker of ['sentinel.config.json', 'quality.config.json']) {
    try {
      if (lstatSync(path.join(candidate, marker)).isFile()) return true;
    } catch {
      /* Marcador ausente. */
    }
  }
  return false;
}

export async function findQualityRoot(startPath: string = process.cwd()): Promise<string> {
  let candidate = path.resolve(startPath);
  try {
    candidate = await realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return path.resolve(startPath);
    throw error;
  }
  /* [028A-6] Marcador declarativo: sentinel.config.json (v2) o
   * quality.config.json (v1). Los symlinks se omiten con lstat para no tomar
   * un marcador colgado de fuera del árbol físico. */
  const markers = ['sentinel.config.json', 'quality.config.json'];
  while (candidate) {
    for (const marker of markers) {
      try {
        const metadata = await lstat(path.join(candidate, marker));
        if (!metadata.isFile()) throw new Error('quality marker is not a regular file');
        return candidate;
      } catch {
        /* Marcador ausente o symlink: sube al padre. */
      }
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return path.resolve(startPath);
}

export function isHeavyCargoCommand(args: string[]): boolean {
  const command = args.find(value => !String(value).startsWith('-'))?.toLowerCase();
  return command === 'test' || command === 'clippy' || command === 'bench';
}

export function isHeavyOverride(options: { allowHeavy?: boolean; ci?: boolean } = {}): boolean {
  return Boolean(
    options.allowHeavy
    || options.ci
    || process.env.GLORY_QUALITY_ALLOW_HEAVY === '1'
    || process.env.GLORY_HEAVY_RUN_TOKEN,
  );
}

export async function inspectHeavyRun(options: HeavyRunOptions): Promise<HeavyRunDecision> {
  const { projectRoot, mode = 'full', allowHeavy = false, now = Date.now() } = options;
  const targetBase = options.targetBase ?? resolveTargetBase();
  const config = await readProjectConfig(projectRoot);
  const cooldownMs = readCooldownMs(config);
  const state = await readJson<HeavyState>(statePath(targetBase), { version: 1, projects: {} });
  const entry = state.projects?.[projectKey(projectRoot)];
  const lastHeavyAt = Number(entry?.lastHeavyAt || 0);
  const elapsed = lastHeavyAt > 0 ? now - lastHeavyAt : Number.POSITIVE_INFINITY;
  const remainingMs = Math.max(0, cooldownMs - elapsed);
  const override = isHeavyOverride({ allowHeavy, ci: mode === 'ci' });
  if (!override && remainingMs > 0) {
    return {
      allowed: false,
      reason: 'cooldown',
      cooldownMs,
      remainingMs,
      nextAllowedAt: new Date(now + remainingMs).toISOString(),
      lastHeavyAt: new Date(lastHeavyAt).toISOString(),
    };
  }
  return { allowed: true, cooldownMs, remainingMs: 0, override };
}

async function clearStaleActiveLock(filePath: string): Promise<ActiveLock | null> {
  const active = await readJson<ActiveLock | null>(filePath, null);
  if (!active) return null;
  if (processAlive(Number(active.pid))) return active;
  await unlink(filePath).catch(() => {});
  return null;
}

export async function acquireHeavyRun(options: HeavyRunOptions): Promise<HeavyRunDecision | HeavyRunLease> {
  const { projectRoot, mode = 'full', taskId = null, command = 'quality-full', allowHeavy = false } = options;
  const targetBase = options.targetBase ?? resolveTargetBase();
  const decision = await inspectHeavyRun({ projectRoot, targetBase, mode, allowHeavy });
  if (!decision.allowed) return decision;

  const guardRoot = resolveGuardRoot(targetBase);
  await mkdir(guardRoot, { recursive: true });
  const lockPath = activePath(targetBase);
  const token = crypto.randomUUID();
  const lock = {
    version: 1,
    token,
    pid: process.pid,
    projectRoot: normalizeRoot(projectRoot),
    taskId,
    command,
    startedAt: new Date().toISOString(),
  };
  const existing = await clearStaleActiveLock(lockPath);
  if (existing) {
    return {
      allowed: false,
      reason: 'active',
      message: `Ya existe una ejecución pesada activa (PID ${existing.pid}).`,
    };
  }
  try {
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return { allowed: false, reason: 'active', message: 'Otra ejecución pesada tomó el guard.' };
    }
    throw error;
  }

  let released = false;
  return {
    ...decision,
    allowed: true,
    token,
    async release(leaseOptions: { status?: string } = {}): Promise<void> {
      const status = leaseOptions.status ?? 'completed';
      if (released) return;
      released = true;
      const stateFile = statePath(targetBase);
      const state = await readJson<HeavyState>(stateFile, { version: 1, projects: {} });
      state.version = 1;
      state.projects ??= {};
      state.projects[projectKey(projectRoot)] = {
        projectRoot: normalizeRoot(projectRoot),
        lastHeavyAt: Date.now(),
        lastStatus: status,
        taskId,
        command,
      };
      await writeJsonAtomic(stateFile, state);
      const current = await readJson<{ token?: string } | null>(lockPath, null);
      if (current?.token === token) await unlink(lockPath).catch(() => {});
    },
  };
}

export function formatHeavyGuardMessage(decision: HeavyRunDecision): string {
  if (decision.reason === 'cooldown') {
    const minutes = Math.ceil((decision.remainingMs ?? 0) / 60_000);
    return `Full diferido por cooldown: faltan aproximadamente ${minutes} min. Próxima ejecución: ${decision.nextAllowedAt}. Usa --allow-heavy solo si es imprescindible.`;
  }
  return decision.message || 'Full diferido porque ya hay otra ejecución pesada activa.';
}
