import * as crypto from 'crypto';
import * as path from 'path';
import { assertSafeBranch } from '../branchValidation';
import { TaskCoordinatorOptions, TaskEvent, TaskRecord } from './taskCoordinatorTypes';

export const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
export const SAFE_AGENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
export const SAFE_LOCK_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
export const SAFE_PROJECT_IDENTITY = /^[a-f0-9]{16}$/u;
export const MAX_HISTORY_EVENTS = 200;
export const MAX_HISTORY_FILES = 2000;
export const MAX_TEXT = 500;

export function boundedText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > MAX_TEXT) throw new Error(`${label} supera ${MAX_TEXT} caracteres`);
  return normalized || undefined;
}

export function safeRelativeReference(value: string | null | undefined, label: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = value.replace(/\\/gu, '/');
  if (!normalized || path.isAbsolute(value) || normalized.split('/').includes('..')) {
    throw new Error(`${label} debe ser una ruta relativa dentro del proyecto`);
  }
  return boundedText(normalized, label);
}

export function eventId(now: number): string {
  return `${now}-${crypto.randomBytes(6).toString('hex')}`;
}

export function appendTaskEvent(record: TaskRecord, event: Omit<TaskEvent, 'eventId' | 'at'> & { now: number }): void {
  const events = record.history ?? [];
  events.push({ eventId: eventId(event.now), at: new Date(event.now).toISOString(), ...event });
  record.history = events.slice(-MAX_HISTORY_EVENTS);
}

export function sanitizeBranch(value: string): string {
  return assertSafeBranch(value);
}

export function requiredPrimaryBranch(options: Pick<TaskCoordinatorOptions, 'primaryBranch' | 'target'>): string {
  if (options.primaryBranch && options.target
    && sanitizeBranch(options.primaryBranch) !== sanitizeBranch(options.target)) {
    throw new Error(`target ${options.target} no coincide con primaryBranch ${options.primaryBranch}`);
  }
  const value = options.primaryBranch ?? options.target;
  if (!value) throw new Error('falta declarar la rama principal del proyecto (primaryBranch)');
  return sanitizeBranch(value);
}

export function sanitizeTaskId(value: string): string {
  if (!SAFE_TASK_ID.test(value)) throw new Error(`task-id inválido: ${value}`);
  return value;
}

export function sanitizeAgent(value: string): string {
  if (!SAFE_AGENT.test(value)) throw new Error(`agent inválido: ${value}`);
  return value;
}
