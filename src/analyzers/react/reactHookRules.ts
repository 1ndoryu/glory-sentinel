/*
 * Reglas de hooks React: useEffect y Zustand.
 * Detecta patrones problematicos en useEffect (cleanup, deps inestables)
 * y uso incorrecto de stores Zustand (sin selector, objeto selector).
 */

import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';

/*
 * Detecta useEffect con async/fetch pero sin AbortController en cleanup.
 * Busca useEffects que lanzan requests pero no retornan funcion de limpieza.
 */
export function verificarUseEffectSinCleanup(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    if (!/useEffect\s*\(/.test(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'useeffect-sin-cleanup')) { continue; }

    /* Buscar en el cuerpo del useEffect (siguiente ~50 lineas) */
    let llaves = 0;
    let tieneAsync = false;
    let tieneFetch = false;
    let tieneAbortController = false;
    let tieneCleanup = false;

    for (let j = i; j < Math.min(lineas.length, i + 50); j++) {
      const l = lineas[j];

      for (const char of l) {
        if (char === '{') { llaves++; }
        if (char === '}') { llaves--; }
      }

      if (/\basync\b/.test(l)) { tieneAsync = true; }
      if (/\bfetch\s*\(|\baxios\b|\bapiCliente\b|\bapiKamples\b|\bwretch\b/.test(l)) { tieneFetch = true; }
      if (/AbortController/.test(l)) { tieneAbortController = true; }
      /* Multiples patrones de cleanup validos */
      if (/return\s*\(\s*\)\s*=>|return\s+function/.test(l)) { tieneCleanup = true; }
      if (/\bactivo\s*=\s*false\b|\bcancelled\s*=\s*true\b|\bcancelado\s*=\s*true\b/.test(l)) { tieneCleanup = true; }

      if (llaves <= 0 && j > i) { break; }
    }

    if ((tieneAsync || tieneFetch) && !tieneAbortController && !tieneCleanup) {
      violaciones.push({
        reglaId: 'useeffect-sin-cleanup',
        mensaje: 'useEffect con async/fetch sin AbortController en cleanup. Puede causar updates en componentes desmontados.',
        severidad: obtenerSeveridadRegla('useeffect-sin-cleanup'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Detecta useEffect con dependencia que se crea inline cada render.
 * Un objeto, array o funcion creado inline cambia su referencia cada render,
 * causando que el useEffect se ejecute infinitamente.
 */
export function verificarUseEffectDepInestable(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Recolectar variables declaradas inline (sin memoizar) */
  const declaracionesInline = new Set<string>();

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    const matchObj = /(?:const|let)\s+(\w+)\s*=\s*\{/.exec(linea);
    if (matchObj && !/useMemo|useCallback/.test(linea)) {
      declaracionesInline.add(matchObj[1]);
    }

    const matchArr = /(?:const|let)\s+(\w+)\s*=\s*\[/.exec(linea);
    if (matchArr && !/useMemo/.test(linea)) {
      declaracionesInline.add(matchArr[1]);
    }

    const matchFn = /(?:const|let)\s+(\w+)\s*=\s*(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/.exec(linea);
    if (matchFn && !/useCallback/.test(linea)) {
      declaracionesInline.add(matchFn[1]);
    }
  }

  if (declaracionesInline.size === 0) { return violaciones; }

  for (let i = 0; i < lineas.length; i++) {
    if (!/useEffect\s*\(/.test(lineas[i])) { continue; }

    for (let j = i; j < Math.min(lineas.length, i + 50); j++) {
      const matchDeps = /\[\s*([^\]]+)\s*\]\s*\)/.exec(lineas[j]);
      if (matchDeps) {
        const deps = matchDeps[1].split(',').map(d => d.trim());
        for (const dep of deps) {
          if (declaracionesInline.has(dep)) {
            violaciones.push({
              reglaId: 'useeffect-dep-inestable',
              mensaje: `'${dep}' se crea inline cada render. useEffect se re-ejecutara infinitamente. Memoizar con useMemo/useCallback.`,
              severidad: obtenerSeveridadRegla('useeffect-dep-inestable'),
              linea: j,
              fuente: 'estatico',
            });
          }
        }
        break;
      }
    }
  }

  return violaciones;
}

/* Detecta useStore() de Zustand sin selector (causa re-renders innecesarios) */
export function verificarZustandSinSelector(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }

    const match = /\buse\w*Store\s*\(\s*\)/.exec(linea);
    if (match) {
      violaciones.push({
        reglaId: 'zustand-sin-selector',
        mensaje: `${match[0]} sin selector. Re-renderiza en CUALQUIER cambio del store. Usar useStore(s => s.campo).`,
        severidad: obtenerSeveridadRegla('zustand-sin-selector'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Detecta selector de Zustand que retorna objeto/array nuevo.
 * useStore(s => ({ x: s.x, y: s.y })) crea un objeto nuevo cada render,
 * anulando la memoizacion. Usar useShallow() o selectores individuales.
 */
export function verificarZustandObjetoSelector(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }

    if (/use\w*Store\s*\(\s*\w+\s*=>\s*\(\s*\{/.test(linea)) {
      violaciones.push({
        reglaId: 'zustand-objeto-selector',
        mensaje: 'Selector de Zustand retorna objeto nuevo cada render. Usar useShallow() o selectores individuales.',
        severidad: obtenerSeveridadRegla('zustand-objeto-selector'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    if (/use\w*Store\s*\(\s*\w+\s*=>\s*\[/.test(linea)) {
      violaciones.push({
        reglaId: 'zustand-objeto-selector',
        mensaje: 'Selector de Zustand retorna array nuevo cada render. Usar useShallow() o selectores individuales.',
        severidad: obtenerSeveridadRegla('zustand-objeto-selector'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
