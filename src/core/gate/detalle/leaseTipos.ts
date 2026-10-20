/* [028A-6] Contrato de los leases: constantes y tipos compartidos por los
 * módulos lease*.ts. Sin lógica, así ningún módulo depende de otro al importarlo. */
export const LEASE_ENV_VAR = 'SENTINEL_GATE_LEASE';
export const LEASE_DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

export interface LeasePayload {
  schemaVersion: 1;
  id: string;
  issuedAt: string;
  expiresAt: string;
  pid: number;
  projectRoot: string;
  command: string;
  taskId: string | null;
}

export interface LeaseFile extends LeasePayload {
  signature: string;
}

export interface IssueLeaseOptions {
  projectRoot: string;
  pid?: number;
  command?: string;
  taskId?: string | null;
  ttlMs?: number;
  now?: number;
  guardRoot?: string;
}

export interface IssuedLease {
  lease: LeaseFile;
  path: string;
  envVar: string;
}

export interface VerifyLeaseOptions {
  leasePath: string;
  projectRoot: string;
  pid: number;
  command: string;
  now?: number;
  parentPidOf?: (pid: number) => Promise<number | null>;
}

export interface LeaseVerification {
  valid: boolean;
  reason?: string;
  lease?: LeaseFile;
}

export interface LeaseSummary {
  id: string;
  pid: number;
  projectRoot: string;
  command: string;
  taskId: string | null;
  issuedAt: string;
  expiresAt: string;
  expired: boolean;
  path: string;
}
