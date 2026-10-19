/* [028A-6] alias current.json, manifiesto de versión y shims del CLI. Extraído de runtimeInstall.ts. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from '../../seguridad-rutas/atomicFile';

export interface CurrentPointer { version: string | null; artifactSha256: string | null }

export async function readCurrentPointer(targetRoot: string): Promise<CurrentPointer> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(targetRoot, 'current.json'), 'utf8')) as { version?: unknown; artifactSha256?: unknown };
    return {
      version: typeof raw.version === 'string' ? raw.version : null,
      artifactSha256: typeof raw.artifactSha256 === 'string' ? raw.artifactSha256 : null,
    };
  } catch {
    return { version: null, artifactSha256: null };
  }
}

export async function readCurrent(targetRoot: string): Promise<string | null> {
  return (await readCurrentPointer(targetRoot)).version;
}

export async function writeVersionManifest(installed: string, version: string, artifactSha256: string): Promise<void> {
  await writeAtomic(path.join(installed, 'manifest.json'), `${JSON.stringify({
    version,
    artifactSha256,
    installedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

export async function writeCliShims(targetRoot: string): Promise<string[]> {
  const bin = path.join(targetRoot, 'bin');
  await fs.mkdir(bin, { recursive: true });
  const written: string[] = [];
  const currentJs = path.join(targetRoot, 'current.js');
  await writeAtomic(currentJs, `#!/usr/bin/env node
/* [028A-6] Resuelve el CLI activo desde current.json (alias atomico).
 * [10AA-2] \`guard\` se resuelve en proceso con el modulo minimo (guardEntry):
 * los shims lo llaman en cada npm/npx/cargo y cargar el CLI completo costaba
 * ~154 modulos. Si el modulo falta (version anterior), cae al CLI completo. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = __dirname;
const current = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8'));
const args = process.argv.slice(2);
const guardEntry = path.join(root, 'versions', current.version, 'out', 'core', 'guard', 'guardEntry.js');
if (args[0] === 'guard' && fs.existsSync(guardEntry)) {
  require(guardEntry).runGuardEntry(args).then(
    code => process.exit(code),
    error => { process.stderr.write(\`[glory-quality] guard: \${error && error.message}\\n\`); process.exit(78); },
  );
} else {
  const cli = path.join(root, 'versions', current.version, 'out', 'cli', 'index.js');
  const child = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
  process.exit(child.status ?? 2);
}
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
