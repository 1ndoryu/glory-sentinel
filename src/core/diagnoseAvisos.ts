/* [10AA-2 F11.2] Avisos no bloqueantes de `sentinel doctor`. Viven fuera de
 * diagnose.ts para no crecer su budget de tamaño (ADR 0001 §8). Solo informan:
 * no cambian `ready` ni el preflight. */
import type { DiagnoseAviso } from './diagnose';
import type { GuardPolicy } from './guardCommand';
import { SHIM_COVERAGE } from './interceptorShims';
import type { RuntimeStatusResult } from './runtimeInstall';

function normalizarEjecutable(value: string): string {
  return value.toLowerCase().replace(/\.(cmd|exe)$/u, '');
}

/* Comandos que la política intercepta y que alguna shell no intercepta: esa
 * shell los ejecuta sin guard. El aviso lo declara en vez de dejarlo implícito
 * (cmd no envuelve eslint/prettier/rustfmt por diseño). */
export function avisosDeCobertura(policy: GuardPolicy): DiagnoseAviso[] {
  if (policy.status !== 'policy') return [];
  const interceptados = new Set<string>([...(policy.tools ?? []), ...(policy.npxTools ?? [])]);
  if ((policy.npmScripts?.size ?? 0) > 0) interceptados.add('npm');
  if ((policy.cargoSubcommands?.size ?? 0) > 0) interceptados.add('cargo');
  const ejecutables = [...interceptados].map(normalizarEjecutable).sort();
  const avisos: DiagnoseAviso[] = [];
  for (const shell of Object.keys(SHIM_COVERAGE) as Array<keyof typeof SHIM_COVERAGE>) {
    const cubiertos = new Set(SHIM_COVERAGE[shell].map(normalizarEjecutable));
    const sinShim = ejecutables.filter(ejecutable => !cubiertos.has(ejecutable));
    if (sinShim.length > 0) {
      avisos.push({ code: 'guard-sin-shim', message: `${shell}: sin shim para ${sinShim.join(', ')}; esa shell no aplica la política a esos comandos` });
    }
  }
  return avisos;
}

/* Runtime instalado distinto de la fuente que ejecuta doctor. */
export function avisosDeRuntime(runtime: RuntimeStatusResult): DiagnoseAviso[] {
  if (!runtime.activeVersion || !runtime.sourceVersion || runtime.activeVersion === runtime.sourceVersion) return [];
  return [{
    code: 'runtime-desfasado',
    message: `runtime activo v${runtime.activeVersion} distinto de la fuente v${runtime.sourceVersion}; reinstala con "sentinel update --with-shims"`,
  }];
}
