/* [028A-6 Fase 1] Clasificador de política del gate agnóstico.
 * Extraído de scripts/quality/policy-decision.mjs de wandori.us: decide
 * modo/acción a partir del descubrimiento de política (no-policy, legacy-v1,
 * policy v2, invalid-policy). Puro: sin I/O ni dependencias del proyecto. */
export const DECISION_STATUSES = new Set(['no-policy', 'legacy-v1', 'policy', 'invalid-policy']);
export const MODES = new Set(['enforce', 'observe', 'pass-through']);

export interface DiscoveredPolicy {
  status?: unknown;
  warning?: string;
  error?: string;
  policy?: { mode?: unknown };
}

export interface PolicyDecision {
  status: string;
  mode: string;
  action: string;
  blocked: boolean;
  reason: string;
  observed?: boolean | string;
}

export function policyDecision(discovered: DiscoveredPolicy): PolicyDecision {
  const status = discovered?.status;
  if (!DECISION_STATUSES.has(status as string)) {
    throw new Error(`Estado de política desconocido: ${String(status)}`);
  }
  if (status !== 'policy') {
    return {
      status: status as string,
      mode: status === 'no-policy' ? 'pass-through' : 'observe',
      action: status === 'legacy-v1' ? 'legacy-fallback' : status === 'invalid-policy' ? 'error' : 'pass-through',
      blocked: false,
      reason: discovered.warning ?? discovered.error ?? String(status),
    };
  }
  const mode = discovered.policy?.mode;
  if (!MODES.has(mode as string)) {
    throw new Error(`Modo de política desconocido: ${String(mode)}`);
  }
  return {
    status,
    mode: mode as string,
    action: mode as string,
    blocked: false,
    reason: 'política v2 válida',
  };
}

export function decisionForGuard(discovered: DiscoveredPolicy, reason: string | null = null): PolicyDecision {
  const decision = policyDecision(discovered);
  if (!reason) return decision;
  if (decision.status === 'legacy-v1') return { ...decision, blocked: true, observed: false };
  if (decision.status !== 'policy') return { ...decision, observed: false };
  if (decision.mode === 'enforce') return { ...decision, blocked: true, observed: false, reason };
  if (decision.mode === 'observe') return { ...decision, blocked: false, observed: reason, reason };
  return { ...decision, blocked: false, observed: false, reason };
}
