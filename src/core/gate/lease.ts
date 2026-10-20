/* [028A-6 Fase 2] Leases efímeros firmados (SNT-10): el gate emite por
 * ejecución un lease HMAC-SHA256 que exime a sus propias herramientas
 * pesadas de los shims interceptores, atado a PID emisor, proyecto,
 * expiración y task ID, con auditoría append-only. Sustituye el
 * SENTINEL_GATE_TOKEN plano (exención por mera presencia) por un
 * credencial verificable: un token robado o copiado deja de servir fuera
 * del árbol de procesos del gate, en otro proyecto o tras expirar.
 *
 * La clave HMAC vive en el guard root del runtime (misma máquina); los shims
 * verifican contra el key del MISMO guard root donde vive el lease
 * (guardRoot = padre del directorio "leases"), por lo que no hay dependencia
 * del target base del operador ni de variables de entorno globales.
 *
 * Fachada: el contrato vive en leaseTipos.ts, la clave en leaseClave.ts, el
 * almacén en leaseRegistro.ts, la verificación en leaseVerificacion.ts y la
 * emisión en leaseEmision.ts. Este archivo conserva la API pública (mismos
 * exports y path). */
export { LEASE_DEFAULT_TTL_MS, LEASE_ENV_VAR } from './detalle/leaseTipos';
export type { LeasePayload, LeaseFile, IssueLeaseOptions, IssuedLease, VerifyLeaseOptions, LeaseVerification, LeaseSummary } from './detalle/leaseTipos';
export { keyPresent } from './detalle/leaseClave';
export { listLeases, pruneExpiredLeases, revokeLease, formatLeaseList } from './detalle/leaseRegistro';
export { verifyLease } from './detalle/leaseVerificacion';
export { leaseTtlFromEnv, issueLease } from './detalle/leaseEmision';
