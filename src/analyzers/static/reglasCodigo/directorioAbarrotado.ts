/*
 * Regla directorio-abarrotado: densidad de archivos de codigo por carpeta,
 * con cache de conteo. Extraida de staticCodeRules.ts.
 */

import * as fs from 'fs';
import { Violacion } from '../../../types';
import { CoreTextDocument } from '../../../core/runtime-proyecto/types';
import { EXCLUSIONES_BASE } from '../../../core/exclusiones';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';

/* [114A-7] Cache de conteo de archivos por directorio para evitar
 * lecturas repetidas del filesystem durante un scan de workspace. */
const cacheConteoDirectorios = new Map<string, number>();
let ultimaLimpiezaCache = Date.now();

/* Limpia el cache periodicamente (cada 30s) para reflejar cambios */
function limpiarCacheSiNecesario(): void {
  const ahora = Date.now();
  if (ahora - ultimaLimpiezaCache > 30_000) {
    cacheConteoDirectorios.clear();
    ultimaLimpiezaCache = ahora;
  }
}

/* Fuerza limpieza del cache (exponer para tests o invalidacion manual) */
export function invalidarCacheDirectorios(): void {
  cacheConteoDirectorios.clear();
}

/* Limite default de archivos por directorio */
const LIMITE_ARCHIVOS_DIRECTORIO = 10;

/* [059A-1] Extensiones que cuentan como codigo para la densidad de directorio.
 * Cargo.toml/Cargo.lock, package.json, README.md, dotfiles, imagenes, etc.
 * son config/infra/docs y NO debian contar: inflaban el conteo y producian
 * falsos positivos (p. ej. la raiz del workspace "abarrotada" por 11+ archivos
 * no-codigo). La densidad mide organizacion del codigo, no del repo. */
const EXTENSIONES_CODIGO = new Set([
  'rs', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue',
  'css', 'scss', 'sass', 'py', 'php', 'go', 'java', 'rb',
  'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'sql',
  'sh', 'bash', 'zsh', 'ps1', 'prisma', 'graphql', 'proto',
]);

function esArchivoCodigo(nombre: string): boolean {
  if (nombre.startsWith('.') || nombre.endsWith('.lock')) {
    return false;
  }
  const punto = nombre.lastIndexOf('.');
  if (punto <= 0) {
    return false; /* Sin extension: Dockerfile, Makefile, LICENSE, etc. no cuentan */
  }
  return EXTENSIONES_CODIGO.has(nombre.slice(punto + 1).toLowerCase());
}

/* [114A-7] Verifica si la carpeta del archivo tiene demasiados archivos de codigo.
 * Soporte de excepciones:
 * 1. sentinel-disable-file directorio-abarrotado en el archivo
 * 2. codeSentinel.directoryExceptions en settings.json (patrones glob)
 * 3. Directorios de infraestructura (node_modules, target, .git, etc.) */
export function verificarDirectorioAbarrotado(
  documento: CoreTextDocument,
  excepciones: string[] = [],
): Violacion[] {
  const texto = documento.getText();
  if (tieneSentinelDisableFile(texto, 'directorio-abarrotado')) {
    return [];
  }

  limpiarCacheSiNecesario();

  const rutaArchivo = documento.fileName.replace(/\\/g, '/');
  const partes = rutaArchivo.split('/');
  partes.pop();
  const directorio = partes.join('/');
  const nombreDirectorio = partes[partes.length - 1] || '';

  /* Excluir directorios de infraestructura. [por que] dist-server es la salida de build del backend
   * (dist-server/server/tareas/...): se mira cualquier segmento ancestro, no solo el directorio inmediato. */
  const dirExcluidos = [...EXCLUSIONES_BASE, '.sqlx', 'completados'];
  if (dirExcluidos.includes(nombreDirectorio) || partes.includes('dist-server')) {
    return [];
  }

  /* Verificar si el directorio esta en la lista de excepciones */
  const rutaRelativa = rutaArchivo.replace(/\/[^/]+$/, '');
  for (const excepcion of excepciones) {
    if (rutaRelativa.includes(excepcion) || nombreDirectorio === excepcion) {
      return [];
    }
  }

  /* Contar archivos en el directorio (con cache) */
  let conteo = cacheConteoDirectorios.get(directorio);
  if (conteo === undefined) {
    try {
      const entradas = fs.readdirSync(directorio);
      conteo = entradas.filter((e: string) => {
        try {
          return fs.statSync(directorio + '/' + e).isFile() && esArchivoCodigo(e);
        } catch {
          return false;
        }
      }).length;
      cacheConteoDirectorios.set(directorio, conteo);
    } catch {
      return [];
    }
  }

  if (conteo <= LIMITE_ARCHIVOS_DIRECTORIO) {
    return [];
  }

  return [{
    reglaId: 'directorio-abarrotado',
    mensaje: `Directorio "${nombreDirectorio}/" contiene ${conteo} archivos (max ${LIMITE_ARCHIVOS_DIRECTORIO}). Reorganizar en subdirectorios por dominio. Excepcion: agregar "${nombreDirectorio}" a codeSentinel.directoryExceptions en settings.json.`,
    severidad: obtenerSeveridadRegla('directorio-abarrotado'),
    linea: 0,
    fuente: 'estatico',
  }];
}
