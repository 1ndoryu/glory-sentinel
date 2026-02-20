/*
 * Servicio de debounce y control de timing para los analisis.
 * Controla el cooldown entre analisis estatico e IA,
 * evita saturar el modelo y gestiona la cola de analisis pendientes.
 */

import * as vscode from 'vscode';
import { EstadoArchivo, ConfiguracionSentinel } from '../types';
import * as crypto from 'crypto';
import { logInfo, logWarn, logError } from '../utils/logger';

/* Mapa de estado por archivo (URI como clave) */
const estadoArchivos = new Map<string, EstadoArchivo>();

/* Cola de analisis IA pendientes (FIFO) */
const colaIA: string[] = [];
let iaEnProgreso = false;

/* Contador de requests IA en el ultimo minuto */
let requestsIAUltimoMinuto = 0;
let timerResetRequests: ReturnType<typeof setTimeout> | null = null;

/* Callback que ejecuta el analisis IA (se inyecta desde el provider) */
let callbackAnalisisIA: ((uri: vscode.Uri) => Promise<void>) | null = null;
let callbackAnalisisEstatico: ((uri: vscode.Uri) => void) | null = null;

/*
 * Registra los callbacks de analisis que se ejecutaran
 * cuando el debounce/cooldown lo permita.
 */
export function registrarCallbacks(
  estatico: (uri: vscode.Uri) => void,
  ia: (uri: vscode.Uri) => Promise<void>
): void {
  callbackAnalisisEstatico = estatico;
  callbackAnalisisIA = ia;
}

/*
 * Programa un analisis estatico con debounce.
 * Se ejecuta rapidamente (500ms por defecto) tras la ultima edicion.
 */
export function programarAnalisisEstatico(
  uri: vscode.Uri,
  config: ConfiguracionSentinel
): void {
  const key = uri.toString();
  const estado = obtenerOCrearEstado(key);

  /* Cancelar timer previo si existe */
  if (estado.timerEstatico) {
    clearTimeout(estado.timerEstatico);
  }

  estado.timerEstatico = setTimeout(() => {
    estado.timerEstatico = null;
    estado.ultimoAnalisisEstatico = Date.now();
    callbackAnalisisEstatico?.(uri);
  }, config.timing.staticDebounceMs);

  estadoArchivos.set(key, estado);
}

/*
 * Programa un analisis IA con delay y cooldown.
 * Se resetea cada vez que el usuario edita el archivo.
 */
export function programarAnalisisIA(
  uri: vscode.Uri,
  config: ConfiguracionSentinel,
  delayMs?: number
): void {
  if (!config.aiAnalysisEnabled) {
    return;
  }

  const key = uri.toString();
  const estado = obtenerOCrearEstado(key);
  const delay = delayMs ?? config.timing.aiDelayOnEditMs;
  const nombreArchivo = key.split(/[\/\\]/).pop() ?? key;

  /* Determinar si habia un timer activo ANTES de cancelarlo */
  const estabaActivo = !!estado.timerIA;
  if (estado.timerIA) {
    clearTimeout(estado.timerIA);
  }

  if (estabaActivo) {
    logInfo(`IA reprogramada para "${nombreArchivo}" (timer cancelado, nuevo delay: ${delay}ms).`);
  } else {
    logInfo(`IA programada para "${nombreArchivo}" en ${delay}ms.`);
  }

  estado.timerIA = setTimeout(async () => {
    estado.timerIA = null;

    /* Verificar cooldown: no re-analizar si el hash no cambio */
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === key);
    if (!doc) {
      logWarn(`IA: documento no disponible al disparar timer (${nombreArchivo}).`);
      return;
    }

    const hashActual = calcularHash(doc.getText());
    if (estado.hash === hashActual && estado.ultimoAnalisisIA > 0) {
      const tiempoDesdeUltimoIA = Date.now() - estado.ultimoAnalisisIA;
      if (tiempoDesdeUltimoIA < config.timing.aiCooldownMs) {
        logInfo(`IA: cooldown activo para "${nombreArchivo}" (${Math.round(tiempoDesdeUltimoIA / 1000)}s < ${config.timing.aiCooldownMs / 1000}s).`);
        return;
      }
    }

    estado.hash = hashActual;

    /* Encolar el analisis IA */
    if (!colaIA.includes(key)) {
      colaIA.push(key);
      logInfo(`IA: "${nombreArchivo}" encolado. Cola: ${colaIA.length} archivo(s).`);
    }
    procesarColaIA(config);
  }, delay);

  estadoArchivos.set(key, estado);
}

/* Procesa la cola de analisis IA (maximo 1 concurrente) */
async function procesarColaIA(config: ConfiguracionSentinel): Promise<void> {
  if (iaEnProgreso || colaIA.length === 0) {
    return;
  }

  /* Rate limiting: max N requests por minuto */
  if (requestsIAUltimoMinuto >= config.limits.maxAiRequestsPerMinute) {
    logWarn(`IA: rate limit alcanzado (${requestsIAUltimoMinuto}/${config.limits.maxAiRequestsPerMinute} req/min). Reintentando en 60s.`);
    return;
  }

  iaEnProgreso = true;
  const key = colaIA.shift()!;

  try {
    requestsIAUltimoMinuto++;
    if (!timerResetRequests) {
      timerResetRequests = setTimeout(() => {
        requestsIAUltimoMinuto = 0;
        timerResetRequests = null;
      }, 60_000);
    }

    const uri = vscode.Uri.parse(key);
    const estado = estadoArchivos.get(key);

    await callbackAnalisisIA?.(uri);

    if (estado) {
      estado.ultimoAnalisisIA = Date.now();
    }
  } catch (error) {
    logError('Error procesando cola IA', error);
  } finally {
    iaEnProgreso = false;
    /* Procesar siguiente en cola si hay */
    if (colaIA.length > 0) {
      procesarColaIA(config);
    }
  }
}

/* Limpia el estado de un archivo (al cerrar) */
export function limpiarEstado(uri: vscode.Uri): void {
  const key = uri.toString();
  const estado = estadoArchivos.get(key);

  if (estado) {
    if (estado.timerEstatico) { clearTimeout(estado.timerEstatico); }
    if (estado.timerIA) { clearTimeout(estado.timerIA); }
  }

  estadoArchivos.delete(key);

  /* Remover de la cola IA si estaba pendiente */
  const index = colaIA.indexOf(key);
  if (index !== -1) {
    colaIA.splice(index, 1);
  }
}

/* Limpia todos los estados y timers */
export function limpiarTodo(): void {
  for (const [, estado] of estadoArchivos) {
    if (estado.timerEstatico) { clearTimeout(estado.timerEstatico); }
    if (estado.timerIA) { clearTimeout(estado.timerIA); }
  }
  estadoArchivos.clear();
  colaIA.length = 0;
  iaEnProgreso = false;

  if (timerResetRequests) {
    clearTimeout(timerResetRequests);
    timerResetRequests = null;
  }
}

/* Obtiene el estado de un archivo, creandolo si no existe */
function obtenerOCrearEstado(key: string): EstadoArchivo {
  const existente = estadoArchivos.get(key);
  if (existente) {
    return existente;
  }

  const nuevo: EstadoArchivo = {
    hash: '',
    ultimoAnalisisEstatico: 0,
    ultimoAnalisisIA: 0,
    timerEstatico: null,
    timerIA: null,
    resultadosEstaticos: [],
    resultadosIA: [],
  };

  estadoArchivos.set(key, nuevo);
  return nuevo;
}

/* Calcula hash MD5 del contenido para detectar cambios */
function calcularHash(contenido: string): string {
  return crypto.createHash('md5').update(contenido).digest('hex');
}

/* Obtiene el estado actual de un archivo (para cache de resultados) */
export function obtenerEstado(uri: vscode.Uri): EstadoArchivo | undefined {
  return estadoArchivos.get(uri.toString());
}

/* Actualiza los resultados cacheados de un archivo */
export function actualizarResultados(
  uri: vscode.Uri,
  tipo: 'estatico' | 'ia',
  diagnosticos: vscode.Diagnostic[]
): void {
  const estado = obtenerOCrearEstado(uri.toString());
  if (tipo === 'estatico') {
    estado.resultadosEstaticos = diagnosticos;
  } else {
    estado.resultadosIA = diagnosticos;
  }
}
