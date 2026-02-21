/*
 * Analyzer especializado para archivos React (TSX/JSX).
 * Detecta patrones especificos del ecosistema React
 * que son dificiles de detectar con regex simples.
 */

import * as vscode from 'vscode';
import { Violacion } from '../types';
import { reglaHabilitada, obtenerSeveridadRegla } from '../config/ruleRegistry';

/*
 * Analiza un archivo React en busca de violaciones especificas.
 * Complementa al staticAnalyzer con detecciones mas contextuales.
 */
export function analizarReact(documento: vscode.TextDocument): Violacion[] {
  const texto = documento.getText();
  const lineas = texto.split('\n');
  const violaciones: Violacion[] = [];

  /* Solo ejecutar verificaciones cuyas reglas esten habilitadas */
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
      if (/\bfetch\s*\(|\baxios\b|\bapiCliente\b|\.get\s*\(|\.post\s*\(/.test(l)) { tieneFetch = true; }
      if (/AbortController/.test(l)) { tieneAbortController = true; }
      if (/return\s*\(\s*\)\s*=>|return\s+function/.test(l)) { tieneCleanup = true; }

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
