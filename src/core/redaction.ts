/* [028A-6 Fase 1] Redacción de secretos agnóstica, extraída de
 * scripts/quality/redaction.mjs. Los reportes publicados nunca deben exponer
 * tokens, credenciales ni valores de claves sensibles. */
const SECRET_NAME = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTHORIZATION|DATABASE_URL)/i;
const ASSIGNMENT = /((?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTHORIZATION|DATABASE_URL)[\w-]*\s*[:=]\s*)[^\s,;]+/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi;

export function redact(value: unknown): string {
  return String(value ?? '')
    .replace(ASSIGNMENT, '$1[REDACTED]')
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(URL_CREDENTIALS, '$1[REDACTED]@')
    .split(/\r?\n/)
    .map(line => SECRET_NAME.test(line) && line.length > 500 ? `${line.slice(0, 160)}…[REDACTED]` : line)
    .join('\n');
}

export function truncate(value: unknown, maxLength = 200_000): string {
  const safe = redact(value);
  return safe.length <= maxLength ? safe : `${safe.slice(0, maxLength)}\n[TRUNCATED]`;
}

export function sanitize(value: unknown, key = ''): unknown {
  if (SECRET_NAME.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(item => sanitize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]));
  }
  return value;
}
