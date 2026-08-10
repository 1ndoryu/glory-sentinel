/* [108A-1 F6] Diagnóstico de shims para `doctor --shims`: qué ejecutable gana
 * realmente en PATH para node/npm/npx/cargo, marcando candidatos shim-like
 * (directorios de shims del guard). Módulo propio (F2 SRP) para mantener
 * src/core/diagnose.ts dentro del budget de tamaño del ADR 0001. */
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface DiagnoseShimEntry {
  executable: string;
  candidates: Array<{ path: string; shimLike: boolean }>;
  winner: string | null;
}

/* [108A-1 F6] Ejecutables relevantes para los shims del guard. */
const SHIM_EXECUTABLES = ['node', 'npm', 'npx', 'cargo'] as const;

function isShimLikeCandidate(candidatePath: string): boolean {
  const lower = candidatePath.toLowerCase();
  return lower.includes('shim')
    || lower.includes('scripts/quality')
    || lower.includes('glorysentinel')
    || lower.includes('glory-quality');
}

function executableCandidates(executable: string): string[] {
  const names = process.platform === 'win32'
    ? [executable, `${executable}.exe`, `${executable}.cmd`, `${executable}.bat`]
    : [executable];
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const found: string[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      try {
        if (existsSync(path.join(dir, name))) {
          found.push(path.join(dir, name));
          break;
        }
      } catch { /* dir inexistente o sin permisos: se ignora */ }
    }
  }
  return found;
}

/* [108A-1 F6] El ganador es el primero en orden de PATH; un shim que precede
 * al ejecutable real gana y debe mostrarse (advertir si el shim no gana). */
export function resolveShimWinners(): Record<string, DiagnoseShimEntry> {
  const result: Record<string, DiagnoseShimEntry> = {};
  for (const executable of SHIM_EXECUTABLES) {
    const candidates = executableCandidates(executable).map(candidate => ({ path: candidate, shimLike: isShimLikeCandidate(candidate) }));
    result[executable] = { executable, candidates, winner: candidates[0]?.path ?? null };
  }
  return result;
}

function winnerIsShim(entry: DiagnoseShimEntry): boolean {
  return entry.candidates.some(candidate => candidate.path === entry.winner && candidate.shimLike);
}

/* [108A-1 F6] Salida enfocada de `doctor --shims`. */
export function formatShims(shims: Record<string, DiagnoseShimEntry>): string {
  const lines = ['[shims] ganador real en PATH (doctor --shims)'];
  for (const [executable, entry] of Object.entries(shims)) {
    const winner = entry.winner ?? 'no encontrado';
    const winnerShim = winnerIsShim(entry);
    lines.push(`[shims]   ${executable.padEnd(6)} -> ${winner}${winnerShim ? ' (shim-like: el shim GANA)' : ''}`);
    if (winnerShim) {
      for (const candidate of entry.candidates) {
        if (candidate.shimLike && candidate.path !== winner) lines.push(`[shims]       (shim-like sin ganar: ${candidate.path})`);
      }
    }
  }
  return lines.join('\n');
}
