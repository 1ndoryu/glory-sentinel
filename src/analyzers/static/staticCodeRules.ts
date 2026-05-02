/*
 * Reglas de estructura y calidad de codigo para el analyzer estatico.
 * Detecta: limites de lineas, useState excesivo, imports muertos,
 * any type explicito, non-null assertion excesivo.
 */

import * as vscode from 'vscode';
import { Violacion } from '../../types';
import { contarLineasEfectivas, obtenerLimiteArchivo } from '../../utils/lineCounter';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';

/* Verifica si el archivo excede los limites de lineas del protocolo.
 * Soporta excepciones con sentinel-disable-file limite-lineas */
export function verificarLimiteLineas(
  documento: vscode.TextDocument,
  nombreArchivo: string,
): Violacion[] {
  const texto = documento.getText();

  /* [25A-SENT-FP] Parser de tokens: soporta multiples reglas en el mismo sentinel-disable-file
   * (ej: sentinel-disable-file regla-a regla-b limite-lineas: comentario).
   * El includes() literal fallaba cuando habia otras reglas entre la directiva y 'limite-lineas'. */
  const deshabilitado = texto.split('\n').some(linea => {
    const idx = linea.indexOf('sentinel-disable-file');
    if (idx === -1) { return false; }
    const tokens = linea
      .slice(idx + 'sentinel-disable-file'.length)
      .replace(/[:*/]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    return tokens.includes('limite-lineas');
  });
  if (deshabilitado) { return []; }

  const limite = obtenerLimiteArchivo(nombreArchivo, documento.fileName);
  if (!limite) { return []; }

  const esRust = nombreArchivo.endsWith('.rs');
  const lineasEfectivas = contarLineasEfectivas(texto, esRust);
  if (lineasEfectivas <= limite.limite) { return []; }

  const ultimaLinea = Math.max(0, documento.lineCount - 1);

  return [{
    reglaId: 'limite-lineas',
    mensaje: `Archivo excede limite de ${limite.limite} lineas para ${limite.tipo} (${lineasEfectivas} lineas efectivas). Dividir obligatoriamente.`,
    severidad: obtenerSeveridadRegla('limite-lineas'),
    linea: ultimaLinea,
    quickFixId: 'mark-split-todo',
    fuente: 'estatico',
  }];
}

/* Verifica si un componente React tiene mas de 3 useState.
 * Cuenta por componente individual para evitar falsos positivos
 * en archivos con multiples sub-componentes. */
export function verificarUseStateExcesivo(
  texto: string,
  documento: vscode.TextDocument,
): Violacion[] {
  /* [104A-4] Soporte sentinel-disable-file para esta regla */
  if (texto.includes('sentinel-disable-file usestate-excesivo')) { return []; }

  const componentDeclarations = texto.match(/(?:const|function)\s+[A-Z][A-Za-z]*\s*(?:=|\()/g) || [];
  const numComponentes = Math.max(1, componentDeclarations.length);

  const matches = texto.match(/\buseState\s*[<(]/g);
  const totalUseState = matches ? matches.length : 0;

  if (totalUseState <= 3 * numComponentes) { return []; }

  if (numComponentes === 1 && totalUseState > 3) {
    return [{
      reglaId: 'usestate-excesivo',
      mensaje: `${totalUseState} useState detectados (max 3). Extraer logica a un hook personalizado.`,
      severidad: obtenerSeveridadRegla('usestate-excesivo'),
      linea: 0,
      quickFixId: 'extract-to-hook',
      fuente: 'estatico',
    }];
  }

  return [];
}

/* [124A-AUDIT1] Regex precompiladas para imports — antes se recreaban por cada línea del archivo */
const REGEX_IMPORT_NOMBRADO = /import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/;
const REGEX_IMPORT_DEFAULT = /^import\s+(?!type\s)(\w+)\s+from\s+['"][^'"]+['"]/;

/* Detecta imports sin uso en archivos JS/TS (heuristico simplificado) */
export function verificarImportsMuertos(
  texto: string,
  documento: vscode.TextDocument,
): Violacion[] {
  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaTrimmed = linea.trim();

    /* Saltar comentarios */
    if (lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/*')) {
      continue;
    }

    /* Import nombrado: import { X, Y } from '...' */
    const matchNombrado = REGEX_IMPORT_NOMBRADO.exec(linea);
    if (matchNombrado) {
      const nombres = matchNombrado[1]
        .split(',')
        .map(n => {
          const limpio = n.trim().replace(/^type\s+/, '');
          return limpio.split(' as ').pop()?.trim();
        })
        .filter(Boolean) as string[];
      const restoTexto = texto.substring(texto.indexOf('\n', texto.indexOf(linea)) + 1);

      for (const nombre of nombres) {
        const regexUso = new RegExp(`\\b${escapeRegex(nombre)}\\b`);
        if (!regexUso.test(restoTexto)) {
          violaciones.push({
            reglaId: 'import-muerto',
            mensaje: `Import "${nombre}" no se usa en el archivo. Eliminar.`,
            severidad: obtenerSeveridadRegla('import-muerto'),
            linea: i,
            quickFixId: 'remove-dead-import',
            fuente: 'estatico',
          });
        }
      }
    }

    /* Import default: import Nombre from '...' (excluyendo type imports) */
    const matchDefault = REGEX_IMPORT_DEFAULT.exec(linea);
    if (matchDefault) {
      const nombre = matchDefault[1];
      const restoTexto = texto.substring(texto.indexOf('\n', texto.indexOf(linea)) + 1);
      const regexUso = new RegExp(`\\b${escapeRegex(nombre)}\\b`);

      if (!regexUso.test(restoTexto)) {
        violaciones.push({
          reglaId: 'import-muerto',
          mensaje: `Import "${nombre}" no se usa en el archivo. Eliminar.`,
          severidad: obtenerSeveridadRegla('import-muerto'),
          linea: i,
          quickFixId: 'remove-dead-import',
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/* Detecta uso de `: any` o `as any` en archivos TS/TSX */
export function verificarAnyType(texto: string, documento: vscode.TextDocument): Violacion[] {
  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaTrimmed = linea.trim();

    if (lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('*') ||
        lineaTrimmed.startsWith('/*') || lineaTrimmed.startsWith('#')) {
      continue;
    }

    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line any-type-explicito')) { continue; }
    if (linea.includes('sentinel-disable any-type-explicito')) { continue; }

    if (/:\s*any\b|as\s+any\b/.test(linea)) {
      if (/eslint-disable|@ts-/.test(linea)) { continue; }

      violaciones.push({
        reglaId: 'any-type-explicito',
        mensaje: 'Tipo "any" explicito. Usar un tipo especifico o "unknown" si el tipo es desconocido.',
        severidad: obtenerSeveridadRegla('any-type-explicito'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Detecta uso excesivo de non-null assertions (!) en TypeScript.
 * Solo reporta si el archivo tiene 5 o mas instancias.
 */
export function verificarNonNullAssertion(texto: string, documento: vscode.TextDocument): Violacion[] {
  const lineas = texto.split('\n');
  const instancias: number[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const trimmed = linea.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
    if (linea.includes('sentinel-disable non-null-assertion-excesivo')) { continue; }
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line non-null-assertion-excesivo')) { continue; }

    const matches = [...linea.matchAll(/[)\]a-zA-Z0-9_>]!\s*[.\[]/g)];
    for (const match of matches) {
      const posExcl = (match.index ?? 0) + match[0].indexOf('!');
      if (posExcl + 1 < linea.length && linea[posExcl + 1] === '=') { continue; }
      if (posExcl > 0 && linea[posExcl - 1] === '!') { continue; }
      instancias.push(i);
    }
  }

  if (instancias.length < 5) { return []; }

  return instancias.map(lineaNum => ({
    reglaId: 'non-null-assertion-excesivo',
    mensaje: `Non-null assertion (!) — ${instancias.length} en este archivo. Indica tipos mal definidos. Tipar correctamente para evitar !.`,
    severidad: obtenerSeveridadRegla('non-null-assertion-excesivo'),
    linea: lineaNum,
    fuente: 'estatico' as const,
  }));
}

/* Escapa caracteres especiales para usar en regex */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

/* [114A-7] Verifica si la carpeta del archivo tiene demasiados archivos.
 * Soporte de excepciones:
 * 1. sentinel-disable-file directorio-abarrotado en el archivo
 * 2. codeSentinel.directoryExceptions en settings.json (patrones glob)
 * 3. Directorios de infraestructura (node_modules, target, .git, etc.) */
export function verificarDirectorioAbarrotado(
  documento: vscode.TextDocument,
): Violacion[] {
  const texto = documento.getText();
  if (texto.includes('sentinel-disable-file directorio-abarrotado')) {
    return [];
  }

  limpiarCacheSiNecesario();

  const rutaArchivo = documento.fileName.replace(/\\/g, '/');
  const partes = rutaArchivo.split('/');
  partes.pop();
  const directorio = partes.join('/');
  const nombreDirectorio = partes[partes.length - 1] || '';

  /* Excluir directorios de infraestructura */
  const dirExcluidos = ['node_modules', 'target', '.git', 'dist', 'build', '.sqlx', 'completados'];
  if (dirExcluidos.includes(nombreDirectorio)) {
    return [];
  }

  /* Obtener excepciones del usuario desde settings.json */
  let excepciones: string[] = [];
  try {
    const config = vscode.workspace.getConfiguration('codeSentinel', documento.uri);
    excepciones = config.get<string[]>('directoryExceptions', []);
  } catch {
    /* Si falla la config, usar defaults */
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
      const fs = require('fs') as typeof import('fs');
      const entradas = fs.readdirSync(directorio);
      conteo = entradas.filter((e: string) => {
        try {
          return fs.statSync(directorio + '/' + e).isFile();
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
