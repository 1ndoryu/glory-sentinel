/* [108A-1 Fase 2] Comando `lease`: emisión, listado, revocación y verificación
 * de los leases que autorizan ejecutar el gate. */
import * as path from 'path';
import { resolveGuardRoot, resolveTargetBase } from '../../core/gate/scheduler';
import {
  formatLeaseList,
  issueLease,
  listLeases,
  revokeLease,
  verifyLease,
} from '../../core/gate/lease';
import { ParsedCliArgs } from '../parseo/argsTypes';
import { usage } from '../parseo/argsUsage';

/* `verify` inválido sale 2: un lease que no se puede comprobar no debe dejar pasar al gate (fail-closed para CI). */
export async function leaseCliTarget(args: ParsedCliArgs): Promise<{ output: string; exitCode: number }> {
  if (args.leaseAction !== 'verify') {
    return { output: await leaseSalida(args), exitCode: 0 };
  }
  if (!args.leasePath) throw new Error('lease verify requiere --lease <path>');
  const projectRoot = path.resolve(args.workspacePath ?? process.cwd());
  const verification = await verifyLease({
    leasePath: args.leasePath,
    projectRoot,
    pid: args.leasePid ?? process.pid,
    command: args.leaseCommand ?? '',
  });
  const output = args.json
    ? `${JSON.stringify(verification, null, 2)}\n`
    : `Lease ${verification.valid ? 'válido' : `inválido (${verification.reason ?? 'desconocido'})`}\n`;
  return { output, exitCode: verification.valid ? 0 : 2 };
}

async function leaseSalida(args: ParsedCliArgs): Promise<string> {
  const guardRoot = resolveGuardRoot(resolveTargetBase());
  switch (args.leaseAction) {
    case 'issue': {
      const projectRoot = path.resolve(args.workspacePath ?? process.cwd());
      const issued = await issueLease({
        projectRoot,
        taskId: args.taskId ?? null,
        command: args.leaseCommand ?? 'gate',
        ttlMs: args.leaseTtlMs,
      });
      return args.json
        ? `${JSON.stringify({ path: issued.path, envVar: issued.envVar, lease: issued.lease }, null, 2)}\n`
        : `Lease emitido:\n  ${issued.envVar}=${issued.path}\n`;
    }
    case 'list': {
      const leases = await listLeases(guardRoot);
      return args.json ? `${JSON.stringify(leases, null, 2)}\n` : formatLeaseList(leases);
    }
    case 'revoke': {
      if (!args.leasePath) throw new Error('lease revoke requiere --lease <path>');
      const result = await revokeLease({ leasePath: args.leasePath, reason: 'revocación manual' });
      return args.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Lease ${result.revoked ? 'revocado' : 'ya ausente'}: ${args.leasePath}\n`;
    }
    default:
      throw new Error(usage());
  }
}
