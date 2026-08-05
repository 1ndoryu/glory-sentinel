/* [028A-6 Fase 1] Runner de etapas acotado del gate agnóstico.
 * Port de scripts/quality/stage-runner.mjs: concurrencia limitada, orden
 * determinista y drenaje de etapas activas ante error/cancelación; nunca
 * agenda trabajo nuevo tras el primer fallo. */
export interface BoundedStagesOptions {
  maxConcurrency?: number;
  isCancelled?: () => boolean;
}

export async function runBoundedStages<T>(
  definitions: readonly T[],
  runStage: (definition: T) => Promise<unknown>,
  options: BoundedStagesOptions = {},
): Promise<unknown[]> {
  const concurrency = Math.max(1, Math.min(options.maxConcurrency ?? 1, definitions.length || 1));
  const results = new Array<unknown>(definitions.length);
  const errors: unknown[] = [];
  let cursor = 0;
  let stopScheduling = false;

  async function worker(): Promise<void> {
    while (true) {
      if (stopScheduling || options.isCancelled?.()) {
        if (options.isCancelled?.()) errors.push(new Error('quality gate cancelado durante las etapas'));
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= definitions.length) return;
      try {
        results[index] = await runStage(definitions[index]);
      } catch (error) {
        stopScheduling = true;
        errors.push(error);
        return;
      }
    }
  }

  /* [028A-6] Espera a todos los workers antes de propagar error/cancelación:
   * las etapas ya iniciadas liberan procesos, locks y temporales, y ningún
   * worker asigna trabajo nuevo después del primer fallo. */
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (errors.length > 0) throw errors[0];
  return results;
}
