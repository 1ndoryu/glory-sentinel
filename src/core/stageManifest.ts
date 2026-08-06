import path from 'node:path';
import * as fs from 'node:fs/promises';
import { StructuredToolDefinition } from './structuredTool';
import { physicallyContained, ensureContainedDirectory } from './pathContainment';

const MANIFEST_SCHEMA_VERSION = 1;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MANIFEST_KEYS = new Set(['schemaVersion', 'stages']);
const STAGE_KEYS = new Set(['name', 'executable', 'args', 'reportPath', 'expectedSchemaVersion', 'timeoutMs', 'cwd']);

export interface StageManifestEnvelope { schemaVersion: 1; stages: StructuredToolDefinition[]; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void { for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label}: clave desconocida '${key}'`); }

async function containedExistingDirectory(root: string, candidate: string, label: string): Promise<string> {
  const resolved = await physicallyContained(root, candidate, label);
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try { stat = await fs.stat(resolved); }
  catch (error) { throw new Error(`${label}: ruta inaccesible (${error instanceof Error ? error.message : String(error)})`); }
  if (!stat.isDirectory()) throw new Error(`${label}: debe ser un directorio`);
  return physicallyContained(root, resolved, label);
}

async function containedManifestFile(workspace: string, manifestPath: string): Promise<string> {
  const resolved = await physicallyContained(workspace, manifestPath, '--stages');
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try { stat = await fs.lstat(resolved); }
  catch (error) { throw new Error(`--stages: ruta inaccesible (${error instanceof Error ? error.message : String(error)})`); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('--stages: debe ser un archivo regular no simbólico');
  return resolved;
}

async function containedReportRoot(workspace: string, reportRoot: string): Promise<string> { return ensureContainedDirectory(workspace, path.resolve(reportRoot), 'reportRoot'); }
async function containedReportPath(reportRoot: string, value: unknown, label: string): Promise<string> {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}: debe ser string no vacío`);
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(reportRoot, value);
  try { await physicallyContained(reportRoot, resolved, label); }
  catch (error) { throw new Error(`${label}: fuera del workspace o symlink/junction escape (${error instanceof Error ? error.message : String(error)})`); }
  return resolved;
}
function parseStringArray(value: unknown, label: string): string[] { if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label}: debe ser una lista de strings`); return [...value]; }

async function normalizeStage(raw: unknown, index: number, workspace: string, reportRoot: string): Promise<StructuredToolDefinition> {
  if (!isRecord(raw)) throw new Error(`etapa ${index}: debe ser un objeto`);
  assertOnlyKeys(raw, STAGE_KEYS, `etapa ${index}`);
  if (typeof raw.name !== 'string' || raw.name.length === 0 || !/^[A-Za-z0-9._-]+$/u.test(raw.name)) throw new Error(`etapa ${index}: name inválido`);
  if (typeof raw.executable !== 'string' || raw.executable.length === 0) throw new Error(`etapa ${index}: executable inválido`);
  const args = parseStringArray(raw.args, `etapa ${index}.args`);
  if (raw.expectedSchemaVersion !== undefined && typeof raw.expectedSchemaVersion !== 'string' && typeof raw.expectedSchemaVersion !== 'number') throw new Error(`etapa ${index}.expectedSchemaVersion: debe ser string o number`);
  if (raw.timeoutMs !== undefined && (typeof raw.timeoutMs !== 'number' || !Number.isInteger(raw.timeoutMs) || raw.timeoutMs < 1 || raw.timeoutMs > MAX_TIMEOUT_MS)) throw new Error(`etapa ${index}.timeoutMs: fuera de 1..${MAX_TIMEOUT_MS}`);
  let cwd: string | undefined;
  if (raw.cwd !== undefined) {
    if (typeof raw.cwd !== 'string') throw new Error(`etapa ${index}.cwd: debe ser string`);
    cwd = await containedExistingDirectory(workspace, path.resolve(workspace, raw.cwd), `etapa ${index}.cwd`);
  }
  const reportPath = await containedReportPath(reportRoot, raw.reportPath === undefined ? `${raw.name}.json` : raw.reportPath, `etapa ${index}.reportPath`);
  return { name: raw.name, executable: raw.executable, args: args.map(arg => arg.replaceAll('{reportPath}', reportPath)), reportPath, expectedSchemaVersion: raw.expectedSchemaVersion ?? '1', timeoutMs: raw.timeoutMs, cwd };
}

export async function loadStageManifest(stagesPath: string, workspace: string, reportRoot: string): Promise<StageManifestEnvelope> {
  const workspaceRoot = await fs.realpath(path.resolve(workspace));
  const resolvedReportRoot = await containedReportRoot(workspaceRoot, reportRoot);
  const resolvedManifest = await containedManifestFile(workspaceRoot, stagesPath);
  const parsed: unknown = JSON.parse(await fs.readFile(resolvedManifest, 'utf8'));
  let rawStages: unknown;
  let schemaVersion = MANIFEST_SCHEMA_VERSION;
  if (Array.isArray(parsed)) rawStages = parsed;
  else {
    if (!isRecord(parsed)) throw new Error('--stages debe ser una lista legacy o un envelope JSON');
    assertOnlyKeys(parsed, MANIFEST_KEYS, 'manifest');
    if (parsed.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw new Error(`manifest.schemaVersion incompatible: se esperaba ${MANIFEST_SCHEMA_VERSION}`);
    schemaVersion = parsed.schemaVersion;
    rawStages = parsed.stages;
  }
  if (!Array.isArray(rawStages)) throw new Error('manifest.stages debe ser una lista');
  const stages = await Promise.all(rawStages.map((item, index) => normalizeStage(item, index, workspaceRoot, resolvedReportRoot)));
  const names = new Set<string>();
  for (const stage of stages) { if (names.has(stage.name)) throw new Error(`manifest: etapa duplicada '${stage.name}'`); names.add(stage.name); }
  return { schemaVersion: schemaVersion as 1, stages };
}

export const stageManifestLimits = { maxTimeoutMs: MAX_TIMEOUT_MS } as const;
