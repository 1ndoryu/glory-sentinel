/* [028A-6 Fase 1] Runtime global versionado de Sentinel: install/update/
 * rollback siguiendo el contrato politica-actualizacion-rollback-sentinel-
 * 2026-08-04.md. El alias activo es current.json (marcador atómico con
 * writeAtomic, sin junctions: portable y seguro en Windows); los shims del
 * CLI resuelven a través de él. Nunca toca perfiles ni PATH: las operaciones
 * son explícitas, con --dry-run y verificación del hash del artefacto. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic } from './atomicFile';

export interface RuntimeInstallOptions {
  targetRoot?: string;
  sourceRoot?: string;
  version?: string;
  dryRun?: boolean;
  includeDependencies?: boolean;
}

export interface RuntimeInstallResult {
  dryRun: boolean;
  targetRoot: string;
  version: string;
  staged: string;
  installed: string;
  artifactSha256: string;
  previousVersion: string | null;
  changedCurrent: boolean;
  shims: string[];
}

export interface RuntimeRollbackOptions {
  targetRoot?: string;
  version?: string;
  dryRun?: boolean;
}

export interface RuntimeRollbackResult {
  dryRun: boolean;
  targetRoot: string;
  previousVersion: string | null;
  restoredVersion: string | null;
  reason: string;
}

export interface RuntimeVersionInfo {
  version: string;
  artifactSha256: string | null;
  installedAt: string | null;
}

export interface RuntimeStatusResult {
  targetRoot: string;
  versions: RuntimeVersionInfo[];
  activeVersion: string | null;
  activeHash: string | null;
  activeVerified: boolean;
  sourceVersion: string | null;
}

export function resolveRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCALAPPDATA
    ? path.join(env.LOCALAPPDATA, 'GlorySentinel')
    : path.join(os.homedir(), '.glory-sentinel');
}

export function resolveSourceRoot(sourceRoot?: string): string {
  return path.resolve(sourceRoot ?? path.resolve(__dirname, '../..'));
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readVersion(sourceRoot: string): Promise<string> {
  const packageJson = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json del origen no contiene version');
  }
  return packageJson.version;
}

async function relativeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files.push(absolute);
    }
  }
  await walk(root);
  return files.sort();
}

/* [028A-6] Hash del artefacto: out/** + package.json (+ lock opcional).
 * node_modules se identifica por el lock y no se hashea. Determinista:
 * rutas ordenadas y contenido. */
export async function hashArtifact(sourceRoot: string): Promise<string> {
  const hash = createHash('sha256');
  const included: string[] = [];
  for (const name of ['package.json', 'package-lock.json']) {
    if (await exists(path.join(sourceRoot, name))) included.push(name);
  }
  const out = path.join(sourceRoot, 'out');
  if (await exists(out)) {
    const files = await relativeFiles(out);
    included.push(...files.map(file => path.relative(sourceRoot, file).replace(/\\/g, '/')));
  }
  for (const relative of included) {
    hash.update(relative);
    hash.update(await fs.readFile(path.join(sourceRoot, relative)));
  }
  return hash.digest('hex');
}

async function copyRuntime(sourceRoot: string, destination: string, includeDependencies: boolean): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) {
    try {
      await fs.copyFile(path.join(sourceRoot, name), path.join(destination, name));
    } catch {
      /* Opcional. */
    }
  }
  const out = path.join(sourceRoot, 'out');
  if (await exists(out)) {
    await fs.cp(out, path.join(destination, 'out'), { recursive: true });
  }
  if (includeDependencies && await exists(path.join(sourceRoot, 'node_modules'))) {
    await fs.cp(path.join(sourceRoot, 'node_modules'), path.join(destination, 'node_modules'), { recursive: true });
  }
}

/* [028A-6] Orden estable de versiones sin localeCompare: partes numéricas
 * primero, resto lexicográfico. Evita 0.10 < 0.9 y dependencia de locale. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (Number.isInteger(na) && Number.isInteger(nb)) {
      if (na !== nb) return na - nb;
    } else {
      const sa = pa[i] ?? '';
      const sb = pb[i] ?? '';
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

/* [028A-6] Timestamp de instalación para elegir la anterior; versiones sin
 * manifest se consideran las más antiguas y nunca ganan el rollback. */
function installedAtMs(info: RuntimeVersionInfo): number {
  if (!info.installedAt) return Number.MIN_SAFE_INTEGER;
  const parsed = Date.parse(info.installedAt);
  return Number.isNaN(parsed) ? Number.MIN_SAFE_INTEGER : parsed;
}

async function readCurrent(targetRoot: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(targetRoot, 'current.json'), 'utf8')) as { version?: unknown };
    return typeof raw.version === 'string' ? raw.version : null;
  } catch {
    return null;
  }
}

async function writeVersionManifest(installed: string, version: string, artifactSha256: string): Promise<void> {
  await writeAtomic(path.join(installed, 'manifest.json'), `${JSON.stringify({
    version,
    artifactSha256,
    installedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

async function writeCliShims(targetRoot: string): Promise<string[]> {
  const bin = path.join(targetRoot, 'bin');
  await fs.mkdir(bin, { recursive: true });
  const written: string[] = [];
  const currentJs = path.join(targetRoot, 'current.js');
  await writeAtomic(currentJs, `#!/usr/bin/env node
/* [028A-6] Resuelve el CLI activo desde current.json (alias atomico). */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = __dirname;
const current = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8'));
const cli = path.join(root, 'versions', current.version, 'out', 'cli', 'index.js');
const child = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(child.status ?? 2);
`);
  written.push(currentJs);
  const escaped = targetRoot.replace(/\//g, '\\');
  const cmd = path.join(bin, 'sentinel.cmd');
  await writeAtomic(cmd, `@echo off\r\nnode "${escaped}\\current.js" %*\r\n`);
  written.push(cmd);
  const sh = path.join(bin, 'sentinel');
  await writeAtomic(sh, `#!/bin/sh\nnode "${targetRoot}/current.js" "$@"\n`);
  written.push(sh);
  return written;
}

export async function installRuntime(options: RuntimeInstallOptions = {}): Promise<RuntimeInstallResult> {
  const targetRoot = path.resolve(options.targetRoot ?? resolveRuntimeRoot());
  const sourceRoot = resolveSourceRoot(options.sourceRoot);
  const version = options.version ?? await readVersion(sourceRoot);
  const dryRun = Boolean(options.dryRun);
  const includeDependencies = options.includeDependencies ?? true;

  const staged = path.join(targetRoot, '.tmp', version);
  const installed = path.join(targetRoot, 'versions', version);
  const previousVersion = await readCurrent(targetRoot);

  /* [028A-6] Flujo no destructivo: el hash se calcula ANTES de escribir el
   * manifest (no se contamina a sí mismo), el staging se limpia por
   * operación (un crash previo no mezcla residuos en el hash) y la versión
   * existente se aparta a .retired/ en vez de borrarse antes del switch
   * (ventana de pérdida cero: un crash entre renames deja current.json
   * apuntando a una versión que sigue existiendo). */
  let artifactSha256 = '';
  let changedCurrent = false;
  const shims: string[] = [];
  if (!dryRun) {
    await fs.mkdir(path.dirname(installed), { recursive: true });
    await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(staged, { recursive: true });
    await copyRuntime(sourceRoot, staged, includeDependencies);
    artifactSha256 = await hashArtifact(staged);
    await writeVersionManifest(staged, version, artifactSha256);
    if (await exists(installed)) {
      const retired = path.join(targetRoot, '.retired', `${version}-${Date.now()}`);
      await fs.mkdir(path.dirname(retired), { recursive: true });
      await fs.rename(installed, retired);
      await fs.rename(staged, installed);
      await fs.rm(retired, { recursive: true, force: true }).catch(() => {});
      /* [028A-6] Limpieza del padre .retired/ cuando queda vacío. */
      await fs.rmdir(path.dirname(retired)).catch(() => {});
    } else {
      await fs.rename(staged, installed);
    }
    if (previousVersion !== version) {
      await writeAtomic(path.join(targetRoot, 'current.json'), `${JSON.stringify({ version, artifactSha256 }, null, 2)}\n`);
      changedCurrent = true;
    }
    shims.push(...await writeCliShims(targetRoot));
  }
  return {
    dryRun,
    targetRoot,
    version,
    staged,
    installed,
    artifactSha256,
    previousVersion,
    changedCurrent,
    shims,
  };
}

export async function listVersions(targetRoot: string): Promise<RuntimeVersionInfo[]> {
  try {
    const entries = await fs.readdir(path.join(targetRoot, 'versions'), { withFileTypes: true });
    const infos: RuntimeVersionInfo[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let manifest: RuntimeVersionInfo | null = null;
      try {
        manifest = JSON.parse(await fs.readFile(path.join(targetRoot, 'versions', entry.name, 'manifest.json'), 'utf8')) as RuntimeVersionInfo;
      } catch {
        /* Sin manifest: metadatos mínimos. */
      }
      infos.push(manifest ?? { version: entry.name, artifactSha256: null, installedAt: null });
    }
    return infos.sort((a, b) => compareVersions(a.version, b.version));
  } catch {
    return [];
  }
}

export async function rollbackRuntime(options: RuntimeRollbackOptions = {}): Promise<RuntimeRollbackResult> {
  const targetRoot = path.resolve(options.targetRoot ?? resolveRuntimeRoot());
  const dryRun = Boolean(options.dryRun);
  const active = await readCurrent(targetRoot);
  const versions = await listVersions(targetRoot);
  const target = options.version
    ?? [...versions]
      .filter(info => info.version !== active)
      .sort((a, b) => installedAtMs(b) - installedAtMs(a))
      .find(() => true)?.version
    ?? null;
  if (!target) {
    return { dryRun, targetRoot, previousVersion: active, restoredVersion: null, reason: 'no hay versión anterior conservada' };
  }
  const targetInfo = versions.find(info => info.version === target) ?? null;
  /* [SNT-10/028A-6] El rollback exige artifactSha256 real y verificado: sin
   * manifest o con hash ausente no se restaura (una versión sin verificar
   * podría ser un directorio corrupto o ajeno al runtime). El hash se
   * recalcula sobre la copia instalada y debe coincidir con el manifest. */
  if (!targetInfo?.artifactSha256) {
    return {
      dryRun,
      targetRoot,
      previousVersion: active,
      restoredVersion: null,
      reason: `la versión ${target} no declara artifactSha256 (manifest ausente o corrupto); no se restaura`,
    };
  }
  let verified = false;
  try {
    verified = await hashArtifact(path.join(targetRoot, 'versions', target)) === targetInfo.artifactSha256;
  } catch {
    verified = false;
  }
  if (!verified) {
    return {
      dryRun,
      targetRoot,
      previousVersion: active,
      restoredVersion: null,
      reason: `la versión ${target} no supera la verificación de artifactSha256; no se restaura`,
    };
  }
  if (!dryRun) {
    await writeAtomic(path.join(targetRoot, 'current.json'), `${JSON.stringify({ version: target, artifactSha256: targetInfo.artifactSha256 }, null, 2)}\n`);
  }
  return { dryRun, targetRoot, previousVersion: active, restoredVersion: target, reason: 'rollback a versión conservada y verificada' };
}

export async function runtimeStatus(options: { targetRoot?: string } = {}): Promise<RuntimeStatusResult> {
  const targetRoot = path.resolve(options.targetRoot ?? resolveRuntimeRoot());
  const versions = await listVersions(targetRoot);
  const activeVersion = await readCurrent(targetRoot);
  const activeInfo = versions.find(info => info.version === activeVersion) ?? null;
  let sourceVersion: string | null = null;
  try {
    sourceVersion = await readVersion(resolveSourceRoot());
  } catch {
    /* Fuente sin package.json. */
  }
  let activeHash: string | null = null;
  let activeVerified = false;
  if (activeVersion && activeInfo?.artifactSha256) {
    try {
      activeHash = await hashArtifact(path.join(targetRoot, 'versions', activeVersion));
      activeVerified = activeHash === activeInfo.artifactSha256;
    } catch {
      /* Runtime no verificable. */
    }
  }
  return { targetRoot, versions, activeVersion, activeHash, activeVerified, sourceVersion };
}

export function formatRuntimeResult(result: RuntimeInstallResult | RuntimeRollbackResult): string {
  const lines: string[] = [];
  if (result.dryRun) lines.push('[dry-run] no se escribió nada');
  lines.push(`Target: ${result.targetRoot}`);
  if ('version' in result) {
    lines.push(`Versión: ${result.version}`);
    lines.push(`Artefacto: ${result.artifactSha256 ? `${result.artifactSha256.slice(0, 16)}…` : 'no hashado (dry-run)'}`);
    lines.push(`Instalado en: ${result.installed}`);
    lines.push(`Versión anterior: ${result.previousVersion ?? 'ninguna'}`);
    lines.push(`Current cambiado: ${result.changedCurrent ? 'sí' : 'no'}`);
    if (result.shims.length > 0) lines.push(`Shims: ${result.shims.join(', ')}`);
  } else {
    lines.push(`Anterior: ${result.previousVersion ?? 'ninguna'}`);
    lines.push(`Restaurada: ${result.restoredVersion ?? 'ninguna'}${result.reason ? ` (${result.reason})` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}
