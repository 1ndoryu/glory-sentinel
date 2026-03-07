/*
 * Servicio de debounce y control de timing para el analisis estatico.
 * Controla el cooldown entre ejecuciones y gestiona estado por archivo.
 */

import * as vscode from 'vscode';
import { EstadoArchivo, ConfiguracionSentinel } from '../types';

/* Mapa de estado por archivo (URI como clave) */
const estadoArchivos = new Map<string, EstadoArchivo>();

let callbackAnalisisEstatico: ((uri: vscode.Uri) => void) | null = null;

/*
 * Registra el callback de analisis estatico que se ejecutara
 * cuando el debounce lo permita.
 */
export function registrarCallbacks(
  estatico: (uri: vscode.Uri) => void
): void {
  callbackAnalisisEstatico = estatico;
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

/* Limpia el estado de un archivo (al cerrar) */
export function limpiarEstado(uri: vscode.Uri): void {
  const key = uri.toString();
  const estado = estadoArchivos.get(key);

  if (estado?.timerEstatico) {
    clearTimeout(estado.timerEstatico);
  }

  estadoArchivos.delete(key);
}

/* Limpia todos los estados y timers */
export function limpiarTodo(): void {
  for (const [, estado] of estadoArchivos) {
    if (estado.timerEstatico) { clearTimeout(estado.timerEstatico); }
  }
  estadoArchivos.clear();
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
    timerEstatico: null,
    resultadosEstaticos: [],
  };

  estadoArchivos.set(key, nuevo);
  return nuevo;
}

/* Obtiene el estado actual de un archivo (para cache de resultados) */
export function obtenerEstado(uri: vscode.Uri): EstadoArchivo | undefined {
  return estadoArchivos.get(uri.toString());
}

/* Actualiza los resultados cacheados de un archivo */
export function actualizarResultados(
  uri: vscode.Uri,
  diagnosticos: vscode.Diagnostic[]
): void {
  const estado = obtenerOCrearEstado(uri.toString());
  estado.resultadosEstaticos = diagnosticos;
}
