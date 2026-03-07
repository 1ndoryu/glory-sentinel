/*
 * Servicio de cache para resultados de analisis estatico.
 * Cachea resultados por hash del contenido del archivo
 * para evitar re-analisis innecesarios.
 */

import * as vscode from 'vscode';
import { calcularHash } from '../utils/analisisHelpers';

interface EntradaCache {
  hash: string;
  diagnosticos: vscode.Diagnostic[];
  timestamp: number;
}

/* Cache en memoria: key = URI del archivo */
const cache = new Map<string, EntradaCache>();

/* TTL del cache: 10 minutos por defecto */
const CACHE_TTL_MS = 10 * 60 * 1000;

/* Tamano maximo del cache */
const MAX_ENTRADAS = 100;

/*
 * Obtiene resultados cacheados si el hash coincide.
 * Retorna null si no hay cache o el hash cambio.
 */
export function obtenerDelCache(
  uri: vscode.Uri,
  contenido: string
): vscode.Diagnostic[] | null {
  const key = uri.toString();
  const entrada = cache.get(key);

  if (!entrada) {
    return null;
  }

  /* Verificar TTL */
  if (Date.now() - entrada.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  /* Verificar hash */
  const hashActual = calcularHash(contenido);
  if (entrada.hash !== hashActual) {
    cache.delete(key);
    return null;
  }

  return entrada.diagnosticos;
}

/*
 * Guarda resultados en cache.
 */
export function guardarEnCache(
  uri: vscode.Uri,
  contenido: string,
  diagnosticos: vscode.Diagnostic[]
): void {
  const key = uri.toString();
  const hash = calcularHash(contenido);

  cache.set(key, {
    hash,
    diagnosticos,
    timestamp: Date.now(),
  });

  /* Evitar que el cache crezca indefinidamente */
  if (cache.size > MAX_ENTRADAS) {
    limpiarEntradasAntiguas();
  }
}

/* Invalida cache de un archivo especifico */
export function invalidarCache(uri: vscode.Uri): void {
  cache.delete(uri.toString());
}

/* Limpia todo el cache */
export function limpiarCacheCompleto(): void {
  cache.clear();
}

/* Elimina las entradas mas antiguas cuando se excede el limite */
function limpiarEntradasAntiguas(): void {
  const entradas = Array.from(cache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp);

  /* Eliminar el 25% mas antiguo */
  const aEliminar = Math.floor(entradas.length * 0.25);
  for (let i = 0; i < aEliminar; i++) {
    cache.delete(entradas[i][0]);
  }
}

/* Expone tamano del cache para tests/debug */
export function tamanoCache(): number {
  return cache.size;
}
