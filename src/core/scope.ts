/* [028A-6 Fase 1] Alcance incremental agnóstico del orquestador.
 * Extraído de scripts/quality/scope.mjs de wandori.us: la decisión de alcance
 * (requested/automatic/effective/execution) no depende de un proyecto; el
 * workspace aporta únicamente configuración declarativa (fullPatterns y
 * perfiles). No importa VS Code, LSP, VarSense ni código de un proyecto. */
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Perfiles con etapa ejecutable que el orquestador puede seleccionar. */
export const EXECUTABLE_PROFILES = new Set(['rust', 'frontend', 'css', 'docs']);

export interface ScopeQualityConfig {
  fullPatterns: string[];
  profiles: Record<string, string[]>;
}

export interface ScopeContext {
  projectRoot: string;
  reportRoot: string;
  qualityConfig: ScopeQualityConfig;
}

export interface ScopeHeavyDeferred {
  reason?: string;
  nextAllowedAt?: string | null;
}

export interface ScopeArgs {
  base?: string;
  full?: boolean;
  ci?: boolean;
  heavyDeferred?: ScopeHeavyDeferred | null;
  profiles?: string[];
}

export interface FullDecision {
  full: boolean;
  effectiveFull: boolean;
  executionFull: boolean;
}

export interface ScopeResult {
  base: string;
  files: string[];
  deletedFiles: string[];
  fingerprintFiles: string[];
  profiles: Set<string>;
  full: boolean;
  requestedFull: boolean;
  automaticFull: boolean;
  effectiveFull: boolean;
  fullReason: string;
  heavyDeferred: boolean;
  executionFull: boolean;
  profileOverride: boolean;
  profileSource: 'cli' | 'env' | null;
  changedFilesPath: string;
  manifestPath: string;
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/');
}

async function gitLines(root: string, args: string[]): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      timeout: 20_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout.split(/\r?\n/).map(item => normalize(item.trim())).filter(Boolean);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git no pudo calcular alcance: ${message}`);
  }
}

function parseChangedStatus(lines: string[]): { files: string[]; deletedFiles: string[]; ambiguous: boolean } {
  const files: string[] = [];
  const deletedFiles: string[] = [];
  let ambiguous = false;
  for (const line of lines) {
    const parts = line.split(/\t+/);
    const status = parts[0] ?? '';
    if (status === 'D' || status.startsWith('R')) ambiguous = true;
    for (const file of parts.slice(1)) {
      if (!file) continue;
      files.push(normalize(file));
      if (status === 'D') deletedFiles.push(normalize(file));
    }
  }
  return { files, deletedFiles, ambiguous };
}

/* [028A-8] Decisión pura del alcance: separa lo que se pidió (requested), lo
 * que el conjunto de cambios exige (automatic), lo que el guard permitió
 * (deferred) y lo que realmente se ejecutará. Un full diferido nunca vuelve a
 * ser full por automaticFull: si el guard bloqueó la ejecución pesada, el
 * alcance efectivo es local-light y el motivo queda en el reporte. */
export function resolveFullDecision({
  requested,
  automatic,
  deferred,
  explicit,
}: {
  requested: boolean;
  automatic: boolean;
  deferred: boolean;
  explicit: boolean;
}): FullDecision {
  const full = Boolean(requested || automatic);
  const effectiveFull = full && !Boolean(deferred);
  const executionFull = effectiveFull && !Boolean(explicit);
  return { full, effectiveFull, executionFull };
}

function fullReason(args: ScopeArgs, automaticFull: boolean): string {
  if (args.heavyDeferred) return 'heavy-deferred';
  if (args.ci) return 'ci';
  if (args.full) return 'requested';
  if (automaticFull) return 'automatic';
  return 'incremental';
}

/* [028A-8] Hashes de contenido de los archivos cambiados para el manifiesto
 * compartido; los borrados/ilegibles no entran (el fingerprint del gate ya
 * marca rutas ausentes). El conjunto cambiado es acotado (≤25 típico), por lo
 * que la lectura extra no escala con el workspace completo. */
async function hashChangedFiles(root: string, files: string[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const relative of files) {
    try {
      const content = await readFile(path.join(root, relative));
      hashes[relative] = createHash('sha256').update(content).digest('hex');
    } catch {
      /* Deleted o ilegible: sin hash. */
    }
  }
  return hashes;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/').toLowerCase();
  let expression = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += escapeRegex(character);
    }
  }
  return new RegExp(`${expression}$`, 'i');
}

async function existingPath(candidate: string): Promise<string | null> {
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export async function expandLocalDependencies(root: string, files: string[]): Promise<string[]> {
  const resolved = new Set(files);
  const queue = [...files];
  while (queue.length > 0) {
    const relative = queue.shift();
    if (!relative || !/\.(?:ts|tsx|js|jsx|mjs)$/.test(relative)) continue;
    let source: string;
    try {
      source = await readFile(path.join(root, relative), 'utf8');
    } catch {
      continue;
    }
    for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]|import\s*\(['"]([^'"]+)['"]\)/g)) {
      const specifier = match[1] ?? match[2];
      if (!specifier || !specifier.startsWith('.')) continue;
      const base = path.normalize(path.join(path.dirname(relative), specifier));
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, path.join(base, 'index.ts')];
      for (const candidate of candidates) {
        const normalized = candidate.replace(/\\/g, '/');
        if (await existingPath(path.join(root, normalized)) && !resolved.has(normalized)) {
          resolved.add(normalized);
          queue.push(normalized);
          break;
        }
      }
    }
  }
  return [...resolved].sort();
}

export function matches(pathName: string, pattern: string): boolean {
  const lowerPath = pathName.replace(/\\/g, '/').toLowerCase();
  const lowerPattern = pattern.replace(/\\/g, '/').toLowerCase();
  if (lowerPattern.startsWith('.') && !lowerPattern.includes('/')) return lowerPath.endsWith(lowerPattern);
  if (lowerPattern.endsWith('/')) return lowerPath.startsWith(lowerPattern);
  if (!/[?*]/.test(lowerPattern)) {
    return lowerPath === lowerPattern || lowerPath.endsWith(`/${lowerPattern}`);
  }
  return globToRegex(lowerPattern).test(lowerPath);
}

export function resolveExplicitProfiles(
  args: ScopeArgs,
  availableProfiles: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): { profiles: Set<string>; explicit: boolean; source: 'cli' | 'env' | null } {
  const cliProfiles = Array.isArray(args.profiles) ? args.profiles : [];
  const envProfiles = typeof env.GLORY_QUALITY_PROFILE === 'string' && env.GLORY_QUALITY_PROFILE.trim().length > 0
    ? env.GLORY_QUALITY_PROFILE.split(',').map(profile => profile.trim()).filter(Boolean)
    : [];
  const requested = cliProfiles.length > 0 ? cliProfiles : envProfiles;
  if (requested.length === 0) return { profiles: new Set(), explicit: false, source: null };
  const unique = [...new Set(requested)];
  const unknown = unique.filter(profile => !Object.prototype.hasOwnProperty.call(availableProfiles, profile));
  if (unknown.length > 0) {
    throw new Error(`Perfil no permitido: ${unknown.join(', ')}`);
  }
  const unsupported = unique.filter(profile => !EXECUTABLE_PROFILES.has(profile));
  if (unsupported.length > 0) {
    throw new Error(
      `Perfil sin etapa ejecutable: ${unsupported.join(', ')}. `
      + `Usa uno de: ${[...EXECUTABLE_PROFILES].join(', ')}`,
    );
  }
  return {
    profiles: new Set(unique),
    explicit: true,
    source: cliProfiles.length > 0 ? 'cli' : 'env',
  };
}

async function writeAtomic(target: string, content: string): Promise<void> {
  const temporary = `${target}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
}

export async function detectScope(context: ScopeContext, args: ScopeArgs): Promise<ScopeResult> {
  const base = args.base ?? 'HEAD';
  const [changedStatus, untracked, tracked] = await Promise.all([
    gitLines(context.projectRoot, ['diff', '--name-status', '--diff-filter=ACMRD', base]),
    gitLines(context.projectRoot, ['ls-files', '--others', '--exclude-standard']),
    gitLines(context.projectRoot, ['ls-files']),
  ]);
  const parsedChanged = parseChangedStatus(changedStatus);
  const files = [...new Set([...parsedChanged.files, ...untracked])].sort();
  const automaticFull = files.length === 0 || parsedChanged.ambiguous || files.some(file =>
    context.qualityConfig.fullPatterns.some(pattern => matches(file, pattern))
  );
  const explicitProfiles = resolveExplicitProfiles(args, context.qualityConfig.profiles);
  /* [028A-8] La decisión es explícita: requested (--full/--ci), automatic
   * (patrones/migraciones/config) y deferred (guard). Si el full fue diferido,
   * effectiveFull=false aunque automaticFull sea cierto: la ejecución pesada
   * está bloqueada y el gate no debe simularla. executionFull añade el filtro
   * de perfil explícito: un perfil conserva fingerprint full sin ampliar la
   * ejecución. */
  const { full, effectiveFull, executionFull } = resolveFullDecision({
    requested: Boolean(args.full || args.ci),
    automatic: automaticFull,
    deferred: Boolean(args.heavyDeferred),
    explicit: explicitProfiles.explicit,
  });
  const fingerprintFiles = effectiveFull
    ? [...new Set([...tracked, ...untracked])].sort()
    : await expandLocalDependencies(context.projectRoot, files);
  const profiles = explicitProfiles.explicit
    ? explicitProfiles.profiles
    : new Set<string>();

  if (!explicitProfiles.explicit) {
    for (const [profile, patterns] of Object.entries(context.qualityConfig.profiles)) {
      if (effectiveFull || files.some(file => patterns.some(pattern => matches(file, pattern)))) profiles.add(profile);
    }
    if (effectiveFull) {
      for (const profile of EXECUTABLE_PROFILES) profiles.add(profile);
    }
  }

  const changedFilesPath = path.join(context.reportRoot, 'changed-files.txt');
  await writeFile(changedFilesPath, `${files.join('\n')}\n`, 'utf8');
  /* [028A-8] Manifiesto único de alcance: archivos cambiados/eliminados, hashes
   * de contenido, perfiles, dependencias locales y decisión full. Sentinel,
   * VarSense, custom y la selección de tests pueden consumirlo sin repetir
   * descubrimientos Git/glob. changed-files.txt se conserva como transporte
   * plano compatible con el contrato `--files-from` de los analizadores. */
  const manifestPath = path.join(context.reportRoot, 'scope-manifest.json');
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    base,
    requestedFull: Boolean(args.full || args.ci),
    automaticFull,
    effectiveFull,
    fullReason: fullReason(args, automaticFull),
    heavyDeferred: args.heavyDeferred
      ? { reason: args.heavyDeferred.reason ?? 'guard', nextAllowedAt: args.heavyDeferred.nextAllowedAt ?? null }
      : null,
    profiles: [...profiles],
    profileOverride: explicitProfiles.explicit,
    files,
    deletedFiles: parsedChanged.deletedFiles,
    fingerprintFiles,
    fileHashes: await hashChangedFiles(context.projectRoot, files),
  };
  await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    base,
    files,
    deletedFiles: parsedChanged.deletedFiles,
    fingerprintFiles,
    profiles,
    full,
    requestedFull: Boolean(args.full || args.ci),
    automaticFull,
    effectiveFull,
    fullReason: fullReason(args, automaticFull),
    heavyDeferred: Boolean(args.heavyDeferred),
    executionFull,
    profileOverride: explicitProfiles.explicit,
    profileSource: explicitProfiles.source,
    changedFilesPath,
    manifestPath,
  };
}
