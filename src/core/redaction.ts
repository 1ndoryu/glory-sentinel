/* [028A-6 Fase 1] Redacción de secretos agnóstica, extraída de
 * scripts/quality/redaction.mjs. Los reportes publicados nunca deben exponer
 * tokens, credenciales ni valores de claves sensibles. */
const SECRET_NAME = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTHORIZATION|DATABASE_URL)/i;
/* [108A-1 F6] `Authorization: Bearer <token>`: el valor consume el prefijo
 * Bearer como parte del token; sin el grupo opcional el ASSIGNMENT se quedaba
 * con "Bearer" y dejaba el token expuesto (hallazgo del fixture de seguridad). */
const ASSIGNMENT = /((?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTHORIZATION|DATABASE_URL)[\w-]*\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi;
/* [108A-1 F6] Backtracking catastrófico preexistente: el esquema greedy
 * `[a-z0-9+.-]*` y las clases de user/pass sin acotar degeneraban a O(n²)
 * sobre líneas largas sin `://` (hallazgo del fixture: 60 s en 300 KiB).
 * Esquema y credenciales quedan acotados a tamaños reales de URL. */
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]{0,32}:\/\/)[^\s:@/]{1,256}:[^\s@/]{1,256}@/gi;

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
