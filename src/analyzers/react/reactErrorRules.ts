/*
 * Reglas de manejo de errores en React/TypeScript.
 * Detecta: console generico en catch, errores enmascarados,
 * promise sin catch, fallo sin feedback, fetch sin timeout.
 */

import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';

/* Detecta console.log/warn generico en bloques catch */
export function verificarConsoleEnCatch(lineas: string[]): Violacion[] {
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
export function verificarErrorEnmascarado(lineas: string[]): Violacion[] {
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

/*
 * Detecta .then() sin .catch() y fuera de try-catch.
 * Los errores de la Promise se pierden silenciosamente.
 */
export function verificarPromiseSinCatch(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (!/\.then\s*\(/.test(linea)) { continue; }
    if (esComentario(linea)) { continue; }

    /* Verificar si estamos dentro de un bloque try */
    let dentroTryCatch = false;
    for (let j = Math.max(0, i - 20); j < i; j++) {
      if (/\btry\s*\{/.test(lineas[j])) { dentroTryCatch = true; }
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
 * Detecta catch blocks que solo hacen console.error/log
 * sin dar feedback visible al usuario (toast, setError, etc.).
 */
export function verificarFalloSinFeedback(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Patrones que indican feedback real al usuario */
  const patronesFeedback = /mostrar(?:Error|Notificacion|Toast)|toast\s*\.\s*(?:error|warning|info|success)|addToast|setError|set[A-Z]\w*Error|agregarNotificacion|notificar|mostrarAlerta/i;

  for (let i = 0; i < lineas.length; i++) {
    if (!/\bcatch\s*\(/.test(lineas[i])) { continue; }
    if (tieneSentinelDisable(lineas, i, 'fallo-sin-feedback')) { continue; }

    let profundidad = 0;
    let inicioBloque = false;
    let tieneConsole = false;
    let tieneFeedback = false;
    let tieneThrow = false;

    for (let j = i; j < Math.min(lineas.length, i + 30); j++) {
      const lineaCatch = lineas[j];

      for (const char of lineaCatch) {
        if (char === '{') {
          inicioBloque = true;
          profundidad++;
        }
        if (char === '}' && inicioBloque) {
          profundidad--;
        }
      }

      if (/console\.\s*(?:error|log|warn)\s*\(/.test(lineaCatch)) { tieneConsole = true; }
      if (patronesFeedback.test(lineaCatch)) { tieneFeedback = true; }
      if (/\bthrow\b/.test(lineaCatch)) { tieneThrow = true; }

      if (inicioBloque && profundidad === 0) { break; }
    }

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
 * Detecta fetch() sin AbortController/signal.
 * Un fetch sin timeout puede colgar indefinidamente si el servidor no responde.
 *
 * Excluye archivos que SON el wrapper de API (apiCliente, httpClient, etc.)
 * ya que ellos SON la abstraccion donde se maneja el timeout.
 */
export function verificarFetchSinTimeout(lineas: string[], nombreArchivo: string): Violacion[] {
  const nombreBase = nombreArchivo.replace(/\.(ts|tsx|js|jsx)$/, '');
  const archivosCliente = ['apiCliente', 'apiClient', 'httpClient', 'gloryFetch', 'fetchWrapper'];
  if (archivosCliente.includes(nombreBase)) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const texto = lineas.join('\n');
  const tieneAbortController = /AbortController/.test(texto);

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (!/\bfetch\s*\(/.test(linea)) { continue; }
    if (esComentario(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'fetch-sin-timeout')) { continue; }

    let tieneSignal = false;
    for (let j = i; j < Math.min(lineas.length, i + 6); j++) {
      if (/\bsignal\b/.test(lineas[j])) {
        tieneSignal = true;
        break;
      }
    }

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
