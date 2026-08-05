/* [028A-6 Fase 1] Cache de etapas del gate agnóstico.
 * Extraído de scripts/quality/cache.mjs de wandori.us: el fingerprint es el
 * contrato de reutilización de un PASS entre ejecuciones (modo
 * CI/full/local-light, runtime, configuración, política, lock y contenido de
 * archivos). No depende del proyecto ni de VarSense. */
import { createHash, Hash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from './atomicFile';

const CACHE_FORMAT_VERSION = 5;

export interface StageCacheContext {
  projectRoot: string;
  cacheRoot?: string;
  ci?: boolean;
  full?: boolean;
  qualityConfig?: unknown;
  toolManifest?: unknown;
  policy?: { policyHash?: string } | null;
  policyIdentity?: { policyHash?: string } | null;
  lock?: unknown;
}

export interface StageCacheScope {
  files?: string[];
  fingerprintFiles?: string[];
  full?: boolean;
  effectiveFull?: boolean;
  executionFull?: boolean;
}

export interface StagePassResult {
  status: 'pass';
  cached?: boolean;
  durationMs?: number;
  [key: string]: unknown;
}

async function hashFile(hash: Hash, root: string, relativePath: string): Promise<void> {
  try {
    hash.update(relativePath);
    hash.update(await readFile(path.join(root, relativePath)));
  } catch {
    /* [018A-4] Un archivo ausente/ilegible no puede reutilizar un PASS: el
     * marcador de faltante entra en el hash y lo invalida. */
    hash.update(`[missing:${relativePath}]`);
  }
}

function cachePath(context: StageCacheContext, stage: string): string {
  return path.join(
    context.cacheRoot ?? path.join(context.projectRoot, '.quality-reports', 'cache'),
    `${stage}.json`,
  );
}

export async function fingerprint(
  context: StageCacheContext,
  scope: StageCacheScope,
  stage: string,
): Promise<string> {
  const hash = createHash('sha256');
  /* [018A-4] Un PASS no puede cruzar cambios de runtime, plataforma o formato
   * del runner aunque el conjunto de archivos permanezca igual. */
  hash.update(`quality-cache-v${CACHE_FORMAT_VERSION}\0`);
  hash.update(`${process.version}\0${process.platform}\0${process.arch}\0`);
  /* [028A-8] CI/full ejecutan validaciones ampliadas y local-light no; un PASS
   * de un modo nunca puede reutilizarse para afirmar cobertura del otro. El
   * modo usa el alcance efectivo (ya resuelto por el guard): un automaticFull
   * permitido queda como full aunque context.full siga false, y un full
   * diferido queda como local-light aunque requestedFull sea cierto. */
  const effectiveFull = scope.effectiveFull ?? scope.executionFull ?? scope.full ?? context.full;
  hash.update(`mode:${context.ci ? 'ci' : effectiveFull ? 'full' : 'local-light'}\0`);
  hash.update(stage);
  hash.update(JSON.stringify(context.qualityConfig ?? null));
  hash.update(JSON.stringify(context.toolManifest ?? null));
  hash.update(`policy:${context.policy?.policyHash ?? context.policyIdentity?.policyHash ?? 'unresolved'}\0`);
  hash.update(`lock:${JSON.stringify(context.lock ?? 'unresolved')}\0`);
  for (const file of scope.fingerprintFiles ?? scope.files ?? []) {
    await hashFile(hash, context.projectRoot, file);
  }
  return hash.digest('hex');
}

export async function readCachedPass(
  context: StageCacheContext,
  stage: string,
  expectedFingerprint: string,
): Promise<StagePassResult | null> {
  try {
    const cached = JSON.parse(await readFile(cachePath(context, stage), 'utf8')) as {
      fingerprint?: unknown;
      result?: { status?: unknown };
    };
    if (cached.fingerprint === expectedFingerprint && cached.result?.status === 'pass') {
      return { ...(cached.result as StagePassResult), cached: true };
    }
  } catch {
    /* Cache ausente o inválida: ejecutar la etapa. */
  }
  return null;
}

export async function writeCachedPass(
  context: StageCacheContext,
  stage: string,
  stageFingerprint: string,
  result: StagePassResult,
): Promise<void> {
  if (result.status !== 'pass') return;
  const target = cachePath(context, stage);
  await mkdir(path.dirname(target), { recursive: true });
  await writeAtomic(target, `${JSON.stringify({ fingerprint: stageFingerprint, result }, null, 2)}\n`);
}
