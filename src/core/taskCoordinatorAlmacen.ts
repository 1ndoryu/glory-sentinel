import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { writeAtomic } from './atomicFile';
import { LOCK_REFRESH_MS, OPERATION_LOCK_TTL_MS, TASK_TTL_MS, TaskRecord } from './taskCoordinatorTypes';
import { sanitizeTaskId } from './taskCoordinatorValidacion';
import { coordinatorDir, lockPath, taskFilePath } from './taskCoordinatorRutas';
import { normalizeTaskRecord } from './taskCoordinatorRegistros';

async function acquireLock(lock: string, key: string): Promise<string> {
  await fs.mkdir(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await fs.mkdir(lock);
      const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
      await fs.writeFile(path.join(lock, 'owner.json'), `${JSON.stringify({ token, pid: process.pid, host: os.hostname(), at: new Date().toISOString() })}\n`, 'utf8');
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let info;
      try {
        info = await fs.stat(lock);
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - info.mtimeMs <= OPERATION_LOCK_TTL_MS) {
        throw new Error(`operación concurrente sobre ${key}; espera al otro proceso`);
      }
      const stalePath = `${lock}.stale-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        /* rename es el takeover atómico: nunca se borra directamente el lock
         * que otro proceso pudo renovar entre stat y cleanup. */
        await fs.rename(lock, stalePath);
        await fs.rm(stalePath, { recursive: true, force: true });
      } catch (takeoverError) {
        if ((takeoverError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw takeoverError;
      }
    }
  }
  throw new Error(`no se pudo adquirir el lock de ${key}`);
}

export async function withLock<T>(root: string, key: string, primaryBranch: string, action: () => Promise<T>): Promise<T> {
  const lock = await lockPath(root, key, primaryBranch);
  const token = await acquireLock(lock, key);
  const refresh = setInterval(() => {
    void fs.utimes(lock, new Date(), new Date()).catch(() => undefined);
  }, LOCK_REFRESH_MS);
  refresh.unref?.();
  let result: T;
  let actionError: unknown;
  try {
    result = await action();
  } catch (error) {
    actionError = error;
  } finally {
    clearInterval(refresh);
    try {
      const owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8')) as { token?: unknown };
      if (owner.token === token) await fs.rm(lock, { recursive: true, force: true });
    } catch (error) {
      /* La verificación de ownership no puede silenciarse: si el lock no es
       * verificable, propagar el error en cleanup evita dejar un lock huérfano
       * aunque la acción haya terminado. Desactivar no-unsafe-finally es
       * intencional: el throw aquí no enmascara un return de action(). */
      // eslint-disable-next-line no-unsafe-finally -- propagar fallos de verificación de ownership en cleanup
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  let cleanupError: unknown;
  try {
    const owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8')) as { token?: unknown };
    if (owner.token === token) await fs.rm(lock, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupError = error;
  }
  if (actionError !== undefined) throw actionError;
  if (cleanupError !== undefined) throw cleanupError;
  return result!;
}

export async function withTaskLock<T>(root: string, taskId: string, primaryBranch: string, action: () => Promise<T>): Promise<T> {
  return withLock(root, `task-${sanitizeTaskId(taskId)}`, primaryBranch, action);
}

export async function hasCaseInsensitiveTaskConflict(root: string, taskId: string, primaryBranch: string): Promise<boolean> {
  const directory = await coordinatorDir(root, primaryBranch);
  try {
    const names = await fs.readdir(directory);
    const expected = `${taskId}.json`.toLowerCase();
    return names.some(name => name.endsWith('.json') && name.toLowerCase() === expected);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function readTask(root: string, taskId: string, primaryBranch: string): Promise<TaskRecord | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(await taskFilePath(root, taskId, primaryBranch), 'utf8'));
    const normalized = normalizeTaskRecord(value);
    if (!normalized || normalized.record.taskId !== taskId || normalized.record.target !== primaryBranch) {
      throw new Error(`metadata inválida para ${taskId}`);
    }
    if (normalized.migrated) await writeTask(root, normalized.record);
    return normalized.record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function stale(record: TaskRecord, now: number): boolean {
  return now - record.updatedAtMs > TASK_TTL_MS;
}

export async function writeTask(root: string, record: TaskRecord): Promise<void> {
  await writeAtomic(await taskFilePath(root, record.taskId, record.target), `${JSON.stringify(record, null, 2)}\n`);
}
