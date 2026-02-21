/*
 * Analyzer especializado para archivos React (TSX/JSX).
 * Detecta patrones especificos del ecosistema React
 * que son dificiles de detectar con regex simples.
 *
 * Sprint 1: useEffect, mutacion, zustand, console, error-enmascarado
 * Sprint 2: zustand-objeto, key-index, componente-sin-hook,
 *           promise-sin-catch, useeffect-dep-inestable
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Violacion } from '../types';
import { reglaHabilitada, obtenerSeveridadRegla } from '../config/ruleRegistry';

/*
 * Analiza un archivo React en busca de violaciones especificas.
 * Complementa al staticAnalyzer con detecciones mas contextuales.
 */
export function analizarReact(documento: vscode.TextDocument): Violacion[] {
  const texto = documento.getText();
  const lineas = texto.split('\n');
  const nombreArchivo = path.basename(documento.fileName);
  const violaciones: Violacion[] = [];

  /* Excluir prototipos de referencia — no son codigo de produccion */
  const nombreBase = nombreArchivo.replace(/\.[^.]+$/, '');
  if (nombreBase === 'ejemplo' || nombreBase === 'example') {
    return violaciones;
  }

  /* Sprint 1 */
  if (reglaHabilitada('useeffect-sin-cleanup')) {
    violaciones.push(...verificarUseEffectSinCleanup(lineas));
  }
  if (reglaHabilitada('mutacion-directa-estado')) {
    violaciones.push(...verificarMutacionDirectaEstado(lineas));
  }
  if (reglaHabilitada('zustand-sin-selector')) {
    violaciones.push(...verificarZustandSinSelector(lineas));
  }
  if (reglaHabilitada('console-generico-en-catch')) {
    violaciones.push(...verificarConsoleEnCatch(lineas));
  }
  if (reglaHabilitada('error-enmascarado')) {
    violaciones.push(...verificarErrorEnmascarado(lineas));
  }

  /* Sprint 2 */
  if (reglaHabilitada('zustand-objeto-selector')) {
    violaciones.push(...verificarZustandObjetoSelector(lineas));
  }
  if (reglaHabilitada('key-index-lista') &&
      !documento.fileName.replace(/\\/g, '/').includes('/Glory/')) {
    violaciones.push(...verificarKeyIndexLista(lineas));
  }
  if (reglaHabilitada('componente-sin-hook-glory') &&
      !documento.fileName.replace(/\\/g, '/').includes('/Glory/')) {
    violaciones.push(...verificarComponenteSinHook(lineas, nombreArchivo));
  }
  if (reglaHabilitada('promise-sin-catch') &&
      !documento.fileName.replace(/\\/g, '/').includes('/Glory/')) {
    violaciones.push(...verificarPromiseSinCatch(lineas));
  }
  if (reglaHabilitada('useeffect-dep-inestable')) {
    violaciones.push(...verificarUseEffectDepInestable(lineas));
  }

  return violaciones;
}

/*
 * Detecta useEffect con async/fetch pero sin AbortController en cleanup.
 * Busca useEffects que lanzan requests pero no retornan funcion de limpieza.
 */
function verificarUseEffectSinCleanup(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    /* Detectar inicio de useEffect */
    if (!/useEffect\s*\(/.test(linea)) {
      continue;
    }

    /* Buscar en el cuerpo del useEffect (siguiente ~40 lineas) */
    const bloqueInicio = i;
    let llaves = 0;
    let bloqueFin = -1;
    let tieneAsync = false;
    let tieneFetch = false;
    let tieneAbortController = false;
    let tieneCleanup = false;

    for (let j = i; j < Math.min(lineas.length, i + 50); j++) {
      const l = lineas[j];

      /* Contar llaves para delimitar el useEffect */
      for (const char of l) {
        if (char === '{') { llaves++; }
        if (char === '}') { llaves--; }
      }

      if (/\basync\b/.test(l)) { tieneAsync = true; }
      if (/\bfetch\s*\(|\baxios\b|\bapiCliente\b|\bapiKamples\b|\bwretch\b/.test(l)) { tieneFetch = true; }
      if (/AbortController/.test(l)) { tieneAbortController = true; }
      /* Reconocer multiples patrones de cleanup validos:
       * - return () => { ... } (arrow cleanup)
       * - return function (named cleanup)
       * - activo = false / cancelled = true (flag-based cleanup en el return) */
      if (/return\s*\(\s*\)\s*=>|return\s+function/.test(l)) { tieneCleanup = true; }
      if (/\bactivo\s*=\s*false\b|\bcancelled\s*=\s*true\b|\bcancelado\s*=\s*true\b/.test(l)) { tieneCleanup = true; }

      if (llaves <= 0 && j > i) {
        bloqueFin = j;
        break;
      }
    }

    /* Si tiene fetch/async pero no tiene cleanup con AbortController */
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
 * Detecta mutaciones directas de estado React.
 * Busca .splice(), .push(), .pop() en variables que parezcan estado.
 */
function verificarMutacionDirectaEstado(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Primero, recolectar nombres de variables de estado */
  const nombresEstado = new Set<string>();
  for (const linea of lineas) {
    const match = /\[\s*(\w+)\s*,\s*set\w+\s*\]\s*=\s*useState/.exec(linea);
    if (match) {
      nombresEstado.add(match[1]);
    }
  }

  if (nombresEstado.size === 0) {
    return violaciones;
  }

  /* Buscar mutaciones directas en variables de estado */
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    for (const nombre of nombresEstado) {
      /* variable.push(), .splice(), .pop(), .shift(), .reverse(), .sort() */
      const regexMutacion = new RegExp(`\\b${nombre}\\s*\\.\\s*(push|splice|pop|shift|unshift|reverse|sort|fill)\\s*\\(`);
      if (regexMutacion.test(linea)) {
        violaciones.push({
          reglaId: 'mutacion-directa-estado',
          mensaje: `Mutacion directa en estado "${nombre}" con .${RegExp.$1}(). Usar spread/map para inmutabilidad.`,
          severidad: obtenerSeveridadRegla('mutacion-directa-estado'),
          linea: i,
          fuente: 'estatico',
        });
      }

      /* variable[index] = valor (asignacion directa a elemento) */
      const regexAsignacion = new RegExp(`\\b${nombre}\\s*\\[`);
      if (regexAsignacion.test(linea) && /=\s*(?!=)/.test(linea.substring(linea.indexOf(nombre)))) {
        /* Excluir comparaciones (==, ===) */
        const despuesDeCorchete = linea.substring(linea.indexOf(nombre));
        if (/\]\s*=[^=]/.test(despuesDeCorchete)) {
          violaciones.push({
            reglaId: 'mutacion-directa-estado',
            mensaje: `Asignacion directa a "${nombre}[i]". Usar map() + spread para inmutabilidad.`,
            severidad: obtenerSeveridadRegla('mutacion-directa-estado'),
            linea: i,
            fuente: 'estatico',
          });
        }
      }
    }
  }

  return violaciones;
}

/* Detecta useStore() de Zustand sin selector (causa re-renders innecesarios) */
function verificarZustandSinSelector(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Patron: useStore() o useNombreStore() sin argumentos */
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

/* Detecta console.log/warn generico en bloques catch */
function verificarConsoleEnCatch(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  let dentroDeCatch = false;
  let profundidadCatch = 0;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    /* Detectar inicio de catch */
    if (/catch\s*\(/.test(linea)) {
      dentroDeCatch = true;
      profundidadCatch = 0;
    }

    if (dentroDeCatch) {
      for (const char of lineas[i]) {
        if (char === '{') { profundidadCatch++; }
        if (char === '}') { profundidadCatch--; }
      }

      /* console.log/warn dentro de catch es probable manejo insuficiente */
      if (/console\.(log|warn)\s*\(/.test(linea) && !/console\.error/.test(linea)) {
        violaciones.push({
          reglaId: 'console-generico-en-catch',
          mensaje: 'console.log/warn en catch. Usar console.error con contexto, o un sistema de logging apropiado.',
          severidad: obtenerSeveridadRegla('console-generico-en-catch'),
          linea: i,
          fuente: 'estatico',
        });
      }

      if (profundidadCatch <= 0) {
        dentroDeCatch = false;
      }
    }
  }

  return violaciones;
}

/*
 * Detecta error enmascarado: retornar ok:true o data vacia dentro de catch.
 * Patron P0 del protocolo: "Si un service catch retorna { ok: true, data: [] },
 * el caller no puede distinguir error de resultado vacio real."
 */
function verificarErrorEnmascarado(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  let dentroDeCatch = false;
  let profundidadCatch = 0;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    if (/catch\s*\(/.test(linea)) {
      dentroDeCatch = true;
      profundidadCatch = 0;
    }

    if (dentroDeCatch) {
      for (const char of lineas[i]) {
        if (char === '{') { profundidadCatch++; }
        if (char === '}') { profundidadCatch--; }
      }

      /* Detectar return con ok: true dentro de catch */
      if (/return\s*\{[^}]*ok\s*:\s*true/.test(linea) ||
          /return\s*\{[^}]*success\s*:\s*true/.test(linea)) {
        violaciones.push({
          reglaId: 'error-enmascarado',
          mensaje: 'return { ok: true } dentro de catch enmascara el error como exito. Usar ok: false.',
          severidad: obtenerSeveridadRegla('error-enmascarado'),
          linea: i,
          fuente: 'estatico',
        });
      }

      /* Detectar return con data vacia fingiendo exito en catch */
      if (/return\s*\{[^}]*data\s*:\s*\[\s*\]/.test(linea) &&
          !/ok\s*:\s*false/.test(linea) &&
          !/error/.test(linea)) {
        violaciones.push({
          reglaId: 'error-enmascarado',
          mensaje: 'return { data: [] } en catch sin indicar error. El caller no distingue error de resultado vacio.',
          severidad: obtenerSeveridadRegla('error-enmascarado'),
          linea: i,
          fuente: 'estatico',
        });
      }

      if (profundidadCatch <= 0) {
        dentroDeCatch = false;
      }
    }
  }

  return violaciones;
}

/* =======================================================================
 * SPRINT 2 — REGLAS NUEVAS
 * ======================================================================= */

/*
 * 2.1 Detecta selector de Zustand que retorna objeto/array nuevo.
 * useStore(s => ({ x: s.x, y: s.y })) crea un objeto nuevo cada render,
 * lo que anula la memoizacion y causa re-renders. Usar useShallow()
 * o selectores individuales: useStore(s => s.x).
 */
function verificarZustandObjetoSelector(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Patron: useStore(s => ({ ... })) — retorna objeto literal */
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

    /* Patron: useStore(s => [s.x, s.y]) — retorna array literal */
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

/*
 * 2.2 Detecta key={index} en callbacks de .map().
 * Usar el indice como key causa reconciliacion incorrecta cuando items
 * se agregan, eliminan o reordenan. Usar un ID unico del item.
 */
function verificarKeyIndexLista(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  let dentroDeMap = false;
  let profundidadMap = 0;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Detectar inicio de .map( callback */
    if (/\.map\s*\(/.test(linea)) {
      dentroDeMap = true;
      profundidadMap = 0;
    }

    if (dentroDeMap) {
      for (const char of linea) {
        if (char === '(') { profundidadMap++; }
        if (char === ')') { profundidadMap--; }
      }

      /* key={index} o key={i} o key={idx} o key={indice} */
      if (/key\s*=\s*\{\s*(index|i|idx|indice)\s*\}/.test(linea)) {
        violaciones.push({
          reglaId: 'key-index-lista',
          mensaje: 'key={index} causa reconciliacion incorrecta en listas dinamicas. Usar ID unico del item.',
          severidad: obtenerSeveridadRegla('key-index-lista'),
          linea: i,
          fuente: 'estatico',
        });
      }

      if (profundidadMap <= 0) {
        dentroDeMap = false;
      }
    }
  }

  return violaciones;
}

/*
 * 2.3 Detecta componentes con logica excesiva que deberia extraerse a un hook.
 * Glory requiere estrictamente: Componente.tsx (solo JSX) + useComponente.ts (logica).
 * Si hay >5 lineas de logica (useEffect, fetch, if/else, etc.) entre imports
 * y el JSX return, reportar.
 */
function verificarComponenteSinHook(lineas: string[], nombreArchivo: string): Violacion[] {
  /* Excluir archivos que ya son hooks */
  if (/^use[A-Z]/.test(nombreArchivo)) { return []; }
  /* Excluir tests y archivos generados */
  if (nombreArchivo.includes('.test.') || nombreArchivo.includes('.spec.') ||
      nombreArchivo.includes('_generated')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  /* Encontrar la zona entre el ultimo import y el primer JSX return */
  let finImports = 0;
  let lineaReturn = -1;

  for (let i = 0; i < lineas.length; i++) {
    const lineaTrimmed = lineas[i].trim();
    if (/^import\s/.test(lineaTrimmed)) {
      finImports = i + 1;
    }
    /* Detectar return con JSX: return ( <..., return <... */
    if (/\breturn\s*\(\s*$|\breturn\s*</.test(lineaTrimmed)) {
      lineaReturn = i;
      break;
    }
  }

  if (lineaReturn <= finImports) { return violaciones; }

  /* Contar lineas con logica significativa entre imports y return.
   * Excluir destructuring de hooks/props (eso es aceptable). */
  let lineasLogica = 0;
  const regexLogica = /\b(useEffect|useState|useMemo|useCallback|useRef|fetch\s*\(|await\s|try\s*\{|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|\.then\s*\()/;

  for (let i = finImports; i < lineaReturn; i++) {
    const lineaTrimmed = lineas[i].trim();

    /* Saltar vacias, comentarios */
    if (lineaTrimmed === '' || lineaTrimmed.startsWith('//') ||
        lineaTrimmed.startsWith('/*') || lineaTrimmed.startsWith('*')) {
      continue;
    }

    /* Saltar destructuring de hook: const { ... } = useHook() */
    if (/^(?:const|let)\s+\{.*\}\s*=\s*use\w+/.test(lineaTrimmed)) { continue; }
    /* Saltar destructuring de array de hook: const [...] = useState() */
    if (/^(?:const|let)\s+\[.*\]\s*=\s*use\w+/.test(lineaTrimmed)) { continue; }
    /* Saltar destructuring de props */
    if (/^(?:const|let)\s+\{.*\}\s*=\s*props/.test(lineaTrimmed)) { continue; }
    /* Saltar firma del componente (export function, const Component) */
    if (/^(?:export\s+)?(?:default\s+)?(?:function|const)\s+\w+/.test(lineaTrimmed) && !/useEffect|useState/.test(lineaTrimmed)) { continue; }

    if (regexLogica.test(lineaTrimmed)) {
      lineasLogica++;
    }
  }

  if (lineasLogica > 5) {
    const nombreComponente = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
    violaciones.push({
      reglaId: 'componente-sin-hook-glory',
      mensaje: `Componente con ${lineasLogica} lineas de logica. Extraer a hook dedicado (use${nombreComponente}).`,
      severidad: obtenerSeveridadRegla('componente-sin-hook-glory'),
      linea: finImports,
      sugerencia: `Crear use${nombreComponente}.ts con la logica y mantener solo JSX en el componente.`,
      fuente: 'estatico',
    });
  }

  return violaciones;
}

/*
 * 2.4 Detecta .then() sin .catch() y fuera de try-catch.
 * Los errores de la Promise se pierden silenciosamente.
 */
function verificarPromiseSinCatch(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (!/\.then\s*\(/.test(linea)) { continue; }

    /* Verificar si estamos dentro de un bloque try */
    let dentroTryCatch = false;
    for (let j = Math.max(0, i - 20); j < i; j++) {
      if (/\btry\s*\{/.test(lineas[j])) { dentroTryCatch = true; }
      /* Si cerramos un catch antes de nuestra linea, el try-catch previo ya termino */
      if (dentroTryCatch && /\bcatch\s*\(/.test(lineas[j])) { dentroTryCatch = false; }
    }

    if (dentroTryCatch) { continue; }

    /* Buscar .catch( en la misma linea o las 5 siguientes */
    let tieneCatch = false;
    for (let j = i; j < Math.min(lineas.length, i + 6); j++) {
      if (/\.catch\s*\(/.test(lineas[j])) {
        tieneCatch = true;
        break;
      }
    }

    if (!tieneCatch) {
      violaciones.push({
        reglaId: 'promise-sin-catch',
        mensaje: '.then() sin .catch() y fuera de try-catch. Los errores de la Promise se pierden.',
        severidad: obtenerSeveridadRegla('promise-sin-catch'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * 2.7 Detecta useEffect con dependencia que se crea inline cada render.
 * Un objeto, array o funcion creado inline cambia su referencia cada render,
 * causando que el useEffect se ejecute infinitamente.
 */
function verificarUseEffectDepInestable(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Recolectar variables declaradas inline (sin memoizar) */
  const declaracionesInline = new Set<string>();

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* const obj = { ... } sin useMemo */
    const matchObj = /(?:const|let)\s+(\w+)\s*=\s*\{/.exec(linea);
    if (matchObj && !/useMemo|useCallback/.test(linea)) {
      declaracionesInline.add(matchObj[1]);
    }

    /* const arr = [...] sin useMemo */
    const matchArr = /(?:const|let)\s+(\w+)\s*=\s*\[/.exec(linea);
    if (matchArr && !/useMemo/.test(linea)) {
      declaracionesInline.add(matchArr[1]);
    }

    /* const fn = () => ... sin useCallback */
    const matchFn = /(?:const|let)\s+(\w+)\s*=\s*(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/.exec(linea);
    if (matchFn && !/useCallback/.test(linea)) {
      declaracionesInline.add(matchFn[1]);
    }
  }

  if (declaracionesInline.size === 0) { return violaciones; }

  /* Buscar useEffect y sus dependencias */
  for (let i = 0; i < lineas.length; i++) {
    if (!/useEffect\s*\(/.test(lineas[i])) { continue; }

    /* Buscar el array de dependencias en las lineas siguientes */
    for (let j = i; j < Math.min(lineas.length, i + 50); j++) {
      /* Patron: ], [dep1, dep2]) — la linea con el cierre del useEffect */
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
