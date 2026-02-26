/*
 * Analyzer especializado para archivos React (TSX/JSX).
 * Detecta patrones especificos del ecosistema React
 * que son dificiles de detectar con regex simples.
 *
 * Sprint 1: useEffect, mutacion, zustand, console, error-enmascarado
 * Sprint 2: zustand-objeto, key-index, componente-sin-hook,
 *           promise-sin-catch, useeffect-dep-inestable
 * Sprint 4: html-nativo-en-vez-de-componente
 * Sprint 5: componente-artesanal, fallo-sin-feedback,
 *           update-optimista-sin-rollback, fetch-sin-timeout
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

  /* Sprint 4: Detectar HTML nativo en vez de componentes propios */
  if (reglaHabilitada('html-nativo-en-vez-de-componente') &&
      !documento.fileName.replace(/\\/g, '/').includes('/Glory/')) {
    violaciones.push(...verificarHtmlNativoEnVezDeComponente(lineas, nombreArchivo));
  }

  /* Sprint 5: Detecciones avanzadas de patrones React */
  if (reglaHabilitada('componente-artesanal') &&
      !documento.fileName.replace(/\\/g, '/').includes('/Glory/')) {
    violaciones.push(...verificarComponenteArtesanal(lineas, nombreArchivo));
  }
  if (reglaHabilitada('fallo-sin-feedback') &&
      !documento.fileName.replace(/\\/g, '/').includes('/Glory/')) {
    violaciones.push(...verificarFalloSinFeedback(lineas));
  }
  if (reglaHabilitada('update-optimista-sin-rollback') &&
      !documento.fileName.replace(/\\/g, '/').includes('/Glory/')) {
    violaciones.push(...verificarUpdateOptimistaSinRollback(lineas));
  }
  if (reglaHabilitada('fetch-sin-timeout') &&
      !documento.fileName.replace(/\\/g, '/').includes('/Glory/')) {
    violaciones.push(...verificarFetchSinTimeout(lineas, nombreArchivo));
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

  /* Si el componente ya importa un hook dedicado (useComponenteName), la logica
   * ya fue extraida. No reportar falsos positivos. */
  const nombreComponente = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  const regexHookDedicado = new RegExp(`\\buse${nombreComponente}\\b`);
  const tieneHookDedicado = lineas.some(l => regexHookDedicado.test(l));
  if (tieneHookDedicado) { return []; }

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
   * Excluir destructuring de hooks/props (eso es aceptable).
   * Distinguir entre logica con estado/efectos (hooks) y logica pura (if/else).
   * Solo logica con hooks/async obliga a extraer un hook. */
  let lineasLogicaTotal = 0;
  let lineasLogicaEstado = 0;
  const regexLogicaTotal = /\b(useEffect|useState|useMemo|useCallback|useRef|fetch\s*\(|await\s|try\s*\{|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|\.then\s*\()/;
  const regexLogicaEstado = /\b(useEffect|useState|useMemo|useCallback|useRef|fetch\s*\(|await\s|\.then\s*\()/;

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

    if (regexLogicaTotal.test(lineaTrimmed)) {
      lineasLogicaTotal++;
    }
    if (regexLogicaEstado.test(lineaTrimmed)) {
      lineasLogicaEstado++;
    }
  }

  /* Criterio dual:
   * - Si hay logica con estado/efectos (hooks, fetch, async) y supera 5 lineas totales -> flag
   * - Si hay SOLO logica pura (if/else, for, switch) sin hooks, necesita >10 lineas para flag
   * Esto evita falsos positivos en componentes con funciones puras de formateo/mapeo */
  const necesitaHook = (lineasLogicaEstado > 0 && lineasLogicaTotal > 5) || lineasLogicaTotal > 10;

  if (necesitaHook) {
    violaciones.push({
      reglaId: 'componente-sin-hook-glory',
      mensaje: `Componente con ${lineasLogicaTotal} lineas de logica (${lineasLogicaEstado} con estado/efectos). Extraer a hook dedicado (use${nombreComponente}).`,
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

/*
 * Sprint 4: Detecta uso de elementos HTML nativos que deberian ser componentes
 * propios del proyecto (Boton, Input, Select, Textarea, Checkbox, Radio, GloryLink).
 *
 * Elementos detectados:
 * - <button> -> usar <Boton>
 * - <input>  -> usar <Input>, <Checkbox>, <Radio> segun el type
 * - <select> -> usar <Select>
 * - <textarea> -> usar <Textarea>
 * - <a href>   -> usar <GloryLink> para navegacion SPA (excluye anchors, downloads, URLs externas)
 *
 * Excluye:
 * - Archivos que SON los propios componentes UI
 * - Tests y archivos generados
 * - Glory framework
 * - Componentes que son wrappers de UI (Campo*, Toggle*, Switch*)
 * - Archivos en blocks/ (landing page blocks con URLs dinamicas)
 */
function verificarHtmlNativoEnVezDeComponente(lineas: string[], nombreArchivo: string): Violacion[] {
  /* No reportar en archivos que son los propios componentes */
  const archivosExcluidos = [
    'Boton', 'Input', 'Select', 'Textarea', 'Checkbox', 'Radio', 'GloryLink', 'PageRenderer',
  ];
  const nombreBase = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  if (archivosExcluidos.includes(nombreBase)) {
    return [];
  }

  /* Excluir componentes que SON wrappers de UI nativos (encapsulan input/textarea/select con logica propia) */
  const prefijosWrapper = ['Campo', 'Toggle', 'Switch'];
  if (prefijosWrapper.some(p => nombreBase.startsWith(p))) {
    return [];
  }

  /* Excluir tests y archivos generados */
  if (nombreArchivo.includes('.test.') || nombreArchivo.includes('.spec.') ||
      nombreArchivo.includes('_generated')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaTrimmed = linea.trim();

    /* Saltar comentarios */
    if (lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('*') ||
        lineaTrimmed.startsWith('/*') || lineaTrimmed.startsWith('{/*')) {
      continue;
    }

    /* Saltar sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line html-nativo-en-vez-de-componente')) {
      continue;
    }
    if (linea.includes('sentinel-disable html-nativo-en-vez-de-componente')) {
      continue;
    }

    /* --- <button> --- solo lowercase nativo, no <Boton> */
    if (/<button[\s>]/.test(linea)) {
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar componente <Boton> en vez de <button> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    /* --- <input> --- solo lowercase nativo, no <Input> */
    if (/<input[\s/]/.test(linea)) {
      /* Excluir input type="checkbox" en componentes Toggle/Switch (ya excluidos arriba por nombre).
       * Tambien excluir input type="hidden" ya que no tiene equivalente en el sistema UI. */
      if (/type\s*=\s*["']hidden["']/i.test(linea)) {
        continue;
      }
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar componente <Input> (o <Checkbox>/<Radio> segun type) en vez de <input> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    /* --- <select> --- solo lowercase nativo, no <Select> */
    if (/<select[\s>]/.test(linea)) {
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar componente <Select> en vez de <select> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    /* --- <textarea> --- solo lowercase nativo, no <Textarea> */
    if (/<textarea[\s>]/.test(linea)) {
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar componente <Textarea> en vez de <textarea> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    /* --- <a href> --- */
    if (/<a\s+(?:[^>]*\s)?href\s*=/i.test(linea)) {
      /* Excluir <a ... download ...> — patron del navegador para descarga de archivos */
      if (/\bdownload\b/i.test(linea)) {
        continue;
      }
      /* Excluir <a href="#..."> — anchor links de scroll, no navegacion SPA */
      if (/href\s*=\s*["']#/i.test(linea)) {
        continue;
      }
      /* Excluir <a href={...}> con expresiones dinamicas en blocks (URLs configurables) */
      if (/href\s*=\s*\{/.test(linea)) {
        continue;
      }
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar <GloryLink> en vez de <a href> para navegacion SPA interna. Import desde core/router.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Sprint 5: Detecta patrones artesanales que reimplementan componentes
 * reutilizables del proyecto (MenuContextual, Modal, etc.).
 *
 * Patrones detectados:
 * - Menu/Dropdown artesanal: useEffect con document.addEventListener('mousedown'/'click')
 *   para cerrar un dropdown. Deberia usar MenuContextual.
 * - Modal artesanal: div con clase overlay/backdrop + onClick para cerrar.
 *   Deberia usar Modal.
 *
 * Excluye los propios componentes UI reutilizables y sus hooks.
 */
function verificarComponenteArtesanal(lineas: string[], nombreArchivo: string): Violacion[] {
  /* No reportar en componentes que SON los reutilizables */
  const componentesExcluidos = [
    'MenuContextual', 'MenuContextualPR', 'Modal', 'ModalBase',
    'ModalInspectorSample', 'ModalFiltros', 'Dropdown',
    'DropdownNotificaciones', 'DropdownMensajes',
    'Popover', 'Tooltip', 'ContenedorToasts', 'Notificacion',
  ];
  const nombreBase = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  if (componentesExcluidos.includes(nombreBase)) {
    return [];
  }

  /* Excluir hooks de los componentes UI reutilizables */
  if (/^use(?:MenuContextual|Modal|Dropdown|Popover|Tooltip)/i.test(nombreBase)) {
    return [];
  }

  /* Excluir tests y archivos generados */
  if (nombreArchivo.includes('.test.') || nombreArchivo.includes('.spec.') ||
      nombreArchivo.includes('_generated')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* sentinel-disable checks */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line componente-artesanal')) {
      continue;
    }
    if (linea.includes('sentinel-disable componente-artesanal')) {
      continue;
    }

    /* --- Patron 1: Outside-click listener artesanal ---
     * document.addEventListener('mousedown'|'click', ...) dentro de useEffect
     * es la senal clasica de un menu/dropdown artesanal. */
    if (/document\.addEventListener\s*\(\s*['"](?:mousedown|click)['"]/i.test(linea)) {
      /* Verificar que estamos dentro de un useEffect (buscar hacia atras) */
      let dentroUseEffect = false;
      for (let j = Math.max(0, i - 15); j < i; j++) {
        if (/useEffect\s*\(/.test(lineas[j])) {
          dentroUseEffect = true;
          break;
        }
      }

      if (dentroUseEffect) {
        violaciones.push({
          reglaId: 'componente-artesanal',
          mensaje: 'Patron de menu/dropdown artesanal detectado (outside-click handler manual). Usar <MenuContextual> del sistema de componentes.',
          severidad: obtenerSeveridadRegla('componente-artesanal'),
          linea: i,
          sugerencia: 'Reemplazar con <MenuContextual items={...} abierto={...} onCerrar={...} />. Import desde components/ui.',
          fuente: 'estatico',
        });
      }
    }

    /* --- Patron 2: Overlay/backdrop artesanal ---
     * Un div con clase overlay/backdrop + onClick que cierra algo = modal artesanal. */
    if (/<div\b[^>]*(?:className|class)\s*=/.test(linea)) {
      const tieneOverlay = /(?:overlay|backdrop|fondo(?:Modal|Oscuro)|fondoModal)/i.test(linea);
      const tieneOnClick = /onClick\s*=\s*\{/.test(linea);

      if (tieneOverlay && tieneOnClick) {
        violaciones.push({
          reglaId: 'componente-artesanal',
          mensaje: 'Patron de modal artesanal detectado (div overlay/backdrop con onClick). Usar <Modal> del sistema de componentes.',
          severidad: obtenerSeveridadRegla('componente-artesanal'),
          linea: i,
          sugerencia: 'Reemplazar con <Modal abierto={...} onCerrar={...}>contenido</Modal>. Import desde components/ui.',
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/*
 * Sprint 5: Detecta catch blocks que solo hacen console.error/log
 * sin dar feedback visible al usuario (toast, setError, etc.).
 * Un console.error solo no es feedback — el usuario no ve la consola.
 */
function verificarFalloSinFeedback(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Patrones que indican feedback real al usuario */
  const patronesFeedback = /mostrar(?:Error|Notificacion|Toast)|toast\s*\.\s*(?:error|warning|info|success)|addToast|setError|set[A-Z]\w*Error|agregarNotificacion|notificar|mostrarAlerta/i;

  for (let i = 0; i < lineas.length; i++) {
    /* Buscar inicio de catch block */
    if (!/\bcatch\s*\(/.test(lineas[i])) { continue; }

    /* sentinel-disable check */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line fallo-sin-feedback')) {
      continue;
    }

    /* Recolectar contenido del catch block */
    let profundidad = 0;
    let inicioBloque = false;
    let tieneConsole = false;
    let tieneFeedback = false;
    let tieneThrow = false;

    for (let j = i; j < Math.min(lineas.length, i + 30); j++) {
      const lineaCatch = lineas[j];

      /* Contar llaves para delimitar el bloque catch.
       * Solo decrementar } despues de encontrar la primera { del catch,
       * para no contar el } del try que precede a catch en la misma linea. */
      for (const char of lineaCatch) {
        if (char === '{') {
          inicioBloque = true;
          profundidad++;
        }
        if (char === '}' && inicioBloque) {
          profundidad--;
        }
      }

      /* Verificar contenido del bloque */
      if (/console\.\s*(?:error|log|warn)\s*\(/.test(lineaCatch)) {
        tieneConsole = true;
      }
      if (patronesFeedback.test(lineaCatch)) {
        tieneFeedback = true;
      }
      if (/\bthrow\b/.test(lineaCatch)) {
        tieneThrow = true;
      }

      /* Si cerramos el bloque catch, evaluar */
      if (inicioBloque && profundidad === 0) {
        break;
      }
    }

    /* Solo reportar si tiene console pero NO tiene feedback ni throw */
    if (tieneConsole && !tieneFeedback && !tieneThrow) {
      violaciones.push({
        reglaId: 'fallo-sin-feedback',
        mensaje: 'Catch con solo console.error/log sin feedback al usuario. El usuario no ve la consola.',
        severidad: obtenerSeveridadRegla('fallo-sin-feedback'),
        linea: i,
        sugerencia: 'Agregar toast o notificacion visible: toast.error("Descripcion del error") o mostrarError(...).',
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Sprint 5: Detecta update optimista (set() antes de await) sin rollback en catch.
 * Si la API falla, el UI queda mostrando el estado optimista sin revertir.
 *
 * Patron detectado:
 * 1. set({ ... }) o set(prev => ...) — update de Zustand
 * 2. Seguido de await (llamada a API)
 * 3. Catch block sin un segundo set() para revertir
 */
function verificarUpdateOptimistaSinRollback(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Detectar set() de Zustand: set({ ... }), set(prev => ...), set(state => ...) */
    if (!/\bset\s*\(\s*(?:\{|(?:prev|state|s)\s*=>)/.test(linea)) { continue; }

    /* sentinel-disable check */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line update-optimista-sin-rollback')) {
      continue;
    }

    /* Buscar un await en las siguientes 10 lineas */
    let lineaAwait = -1;
    for (let j = i + 1; j < Math.min(lineas.length, i + 10); j++) {
      if (/\bawait\b/.test(lineas[j])) {
        lineaAwait = j;
        break;
      }
    }

    if (lineaAwait === -1) { continue; }

    /* Hay set() seguido de await = potencial update optimista.
     * Buscar catch block despues del await. */
    for (let j = lineaAwait; j < Math.min(lineas.length, lineaAwait + 30); j++) {
      if (!/\bcatch\s*\(/.test(lineas[j])) { continue; }

      /* Hay catch. Buscar set() dentro del catch (rollback) */
      let tieneRollback = false;
      let profundidad = 0;
      let dentroBloque = false;

      for (let k = j; k < Math.min(lineas.length, j + 20); k++) {
        for (const c of lineas[k]) {
          if (c === '{') { profundidad++; dentroBloque = true; }
          if (c === '}' && dentroBloque) { profundidad--; }
        }
        if (/\bset\s*\(/.test(lineas[k])) {
          tieneRollback = true;
          break;
        }
        if (dentroBloque && profundidad === 0) { break; }
      }

      if (!tieneRollback) {
        violaciones.push({
          reglaId: 'update-optimista-sin-rollback',
          mensaje: 'Update optimista: set() antes de await sin rollback en catch. Si la API falla, el UI queda inconsistente.',
          severidad: obtenerSeveridadRegla('update-optimista-sin-rollback'),
          linea: i,
          sugerencia: 'Guardar valor previo antes del set() optimista y restaurarlo en catch: catch(e) { set(valorPrevio); }',
          fuente: 'estatico',
        });
      }
      break;
    }
  }

  return violaciones;
}

/*
 * Sprint 5: Detecta fetch() sin AbortController/signal.
 * Un fetch sin timeout puede colgar indefinidamente si el servidor no responde.
 *
 * Excluye archivos que SON el wrapper de API (apiCliente, httpClient, etc.)
 * ya que ellos SON la abstraccion donde se maneja el timeout.
 */
function verificarFetchSinTimeout(lineas: string[], nombreArchivo: string): Violacion[] {
  /* Excluir archivos que SON el cliente/wrapper HTTP */
  const nombreBase = nombreArchivo.replace(/\.(ts|tsx|js|jsx)$/, '');
  const archivosCliente = ['apiCliente', 'apiClient', 'httpClient', 'gloryFetch', 'fetchWrapper'];
  if (archivosCliente.includes(nombreBase)) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const texto = lineas.join('\n');

  /* Si el archivo ya usa AbortController, asumimos que maneja timeouts correctamente */
  const tieneAbortController = /AbortController/.test(texto);

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Detectar fetch( directo */
    if (!/\bfetch\s*\(/.test(linea)) { continue; }

    /* Excluir si es un import, definicion de tipo o comentario */
    const trimmed = linea.trim();
    if (/^(?:import|type|interface|\/\/|\*|\/\*)/.test(trimmed)) { continue; }

    /* sentinel-disable check */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line fetch-sin-timeout')) {
      continue;
    }

    /* Buscar signal en la misma linea o las 5 siguientes (opciones del fetch) */
    let tieneSignal = false;
    for (let j = i; j < Math.min(lineas.length, i + 6); j++) {
      if (/\bsignal\b/.test(lineas[j])) {
        tieneSignal = true;
        break;
      }
    }

    /* Si no hay signal Y el archivo no tiene AbortController global, reportar */
    if (!tieneSignal && !tieneAbortController) {
      violaciones.push({
        reglaId: 'fetch-sin-timeout',
        mensaje: 'fetch() sin AbortController/signal. Puede colgar indefinidamente si el servidor no responde.',
        severidad: obtenerSeveridadRegla('fetch-sin-timeout'),
        linea: i,
        sugerencia: 'Usar AbortController con timeout: const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 30000); fetch(url, { signal: ctrl.signal })',
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
