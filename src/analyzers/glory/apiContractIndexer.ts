/*
 * Indexa los contratos de la API REST de WordPress:
 * - Lee App/Api/*Controller.php
 * - Extrae register_rest_route → metodo callback
 * - Para cada metodo, extrae las claves de WP_REST_Response
 * - Expone un mapa: endpoint → Set<claves>
 *
 * Usado por apiContractRules.ts para detectar mismatches
 * entre lo que PHP devuelve y lo que TypeScript consume.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logInfo, logWarn } from '../../utils/logger';

/* Tipo del contrato: endpoint → claves que devuelve el PHP */
export interface ContratoEndpoint {
  ruta: string;           /* e.g. '/admin/estadisticas' */
  metodo: string;         /* e.g. 'estadisticas' */
  claves: Set<string>;    /* e.g. Set{'success','estadisticas'} */
  archivo: string;        /* ruta del controller */
  linea: number;          /* linea del WP_REST_Response */
}

let cacheContratos: Map<string, ContratoEndpoint> | null = null;
let apiWatcher: vscode.FileSystemWatcher | null = null;

/* Acceso publico al indice */
export function obtenerContratos(): Map<string, ContratoEndpoint> | null {
  return cacheContratos;
}

/*
 * Inicializa el indexer: escanea controllers y configura watcher.
 */
export function inicializarApiContractIndexer(context: vscode.ExtensionContext): void {
  cargarContratos();

  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return; }

  for (const folder of folders) {
    const rutaApi = path.join(folder.uri.fsPath, 'App', 'Api');
    if (!fs.existsSync(rutaApi)) { continue; }

    const patron = new vscode.RelativePattern(rutaApi, '*Controller.php');
    apiWatcher = vscode.workspace.createFileSystemWatcher(patron);

    const recargar = () => {
      logInfo('ApiContractIndexer: controller cambio, recargando...');
      cacheContratos = null;
      cargarContratos();
    };

    apiWatcher.onDidChange(recargar);
    apiWatcher.onDidCreate(recargar);
    apiWatcher.onDidDelete(recargar);
    context.subscriptions.push(apiWatcher);
    break;
  }
}

/*
 * Escanea todos los *Controller.php en App/Api/ y construye el mapa.
 */
export function cargarContratos(): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return; }

  cacheContratos = new Map();

  for (const folder of folders) {
    const rutaApi = path.join(folder.uri.fsPath, 'App', 'Api');
    if (!fs.existsSync(rutaApi)) { continue; }

    const archivos = fs.readdirSync(rutaApi)
      .filter(f => f.endsWith('Controller.php'));

    for (const archivo of archivos) {
      const rutaCompleta = path.join(rutaApi, archivo);
      try {
        const contenido = fs.readFileSync(rutaCompleta, 'utf-8');
        indexarController(contenido, rutaCompleta);
      } catch (err) {
        logWarn(`ApiContractIndexer: error al leer ${archivo} — ${err}`);
      }
    }
  }

  logInfo(`ApiContractIndexer: ${cacheContratos.size} endpoints indexados.`);
}

/*
 * Parsea un controller PHP:
 * 1. Extrae rutas y callbacks de register_rest_route(...)
 * 2. Para cada callback, busca el metodo y extrae claves del response
 */
function indexarController(contenido: string, rutaArchivo: string): void {
  if (!cacheContratos) { return; }

  const lineas = contenido.split('\n');

  /* Paso 1: mapear ruta → nombre de metodo */
  const rutaMetodo = new Map<string, string>();
  const regexRuta = /register_rest_route\s*\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]/;
  const regexCallback = /['"]callback['"]\s*=>\s*\[\s*self::class\s*,\s*['"](\w+)['"]\s*\]/;

  for (let i = 0; i < lineas.length; i++) {
    const lineaActual = lineas[i];
    const matchRuta = regexRuta.exec(lineaActual);
    if (!matchRuta) { continue; }

    const ruta = matchRuta[1];

    /* Buscar callback en las lineas cercanas (hasta 5 lineas despues) */
    let callback: string | null = null;
    for (let j = i; j < Math.min(i + 6, lineas.length); j++) {
      const matchCb = regexCallback.exec(lineas[j]);
      if (matchCb) {
        callback = matchCb[1];
        break;
      }
    }

    if (callback) {
      rutaMetodo.set(callback, ruta);
    }
  }

  /* Paso 2: para cada metodo, extraer claves de WP_REST_Response([...]) */
  const regexMetodo = /(?:public\s+)?(?:static\s+)?function\s+(\w+)\s*\(/;
  const regexResponse = /new\s+WP_REST_Response\s*\(\[/;
  const regexClave = /['"](\w+)['"]\s*=>/;

  let metodoActual: string | null = null;
  let metodoLinea = 0;
  let profundidad = 0;
  let dentroDeMetodo = false;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Detectar inicio de metodo */
    const matchMetodo = regexMetodo.exec(linea);
    if (matchMetodo) {
      metodoActual = matchMetodo[1];
      metodoLinea = i;
      profundidad = 0;
      dentroDeMetodo = false;
    }

    /* Contar llaves para tracking del scope del metodo */
    for (const c of linea) {
      if (c === '{') {
        if (metodoActual && !dentroDeMetodo) { dentroDeMetodo = true; }
        profundidad++;
      }
      if (c === '}') { profundidad--; }
    }

    if (dentroDeMetodo && profundidad <= 0) {
      metodoActual = null;
      dentroDeMetodo = false;
    }

    /* Buscar WP_REST_Response dentro del metodo actual */
    if (!metodoActual || !dentroDeMetodo) { continue; }
    if (!regexResponse.test(linea)) { continue; }

    /* Solo tomar el primer WP_REST_Response con status 200 (exito) */
    const ruta = rutaMetodo.get(metodoActual);
    if (!ruta) { continue; }

    /* Extraer claves del array asociativo en las proximas lineas */
    const claves = new Set<string>();
    let profArray = 0;
    let inicioArray = false;

    for (let j = i; j < Math.min(i + 30, lineas.length); j++) {
      const lineaResp = lineas[j];

      for (const c of lineaResp) {
        if (c === '[') { profArray++; inicioArray = true; }
        if (c === ']') { profArray--; }
      }

      /* Solo extraer claves del primer nivel del array */
      if (inicioArray && profArray === 1) {
        const matchClave = regexClave.exec(lineaResp);
        if (matchClave) {
          claves.add(matchClave[1]);
        }
      }

      /* Fin del array principal */
      if (inicioArray && profArray <= 0) { break; }
    }

    if (claves.size > 0) {
      /* Normalizar ruta: quitar regex de params y namespace */
      const rutaNorm = normalizarRutaEndpoint(ruta);
      cacheContratos.set(rutaNorm, {
        ruta: rutaNorm,
        metodo: metodoActual,
        claves,
        archivo: rutaArchivo,
        linea: i,
      });
      /* Solo tomar el primer response exitoso del metodo */
      break;
    }
  }
}

/*
 * Normaliza la ruta de un endpoint para comparar con TS.
 * '/admin/reservas(?P<id>\d+)/estado' → 'reservas/:id/estado'
 * '/admin/vehiculos' → 'vehiculos'
 */
function normalizarRutaEndpoint(ruta: string): string {
  return ruta
    .replace(/^\//, '')                      /* quitar / inicial */
    .replace(/\(\?P<\w+>[^)]+\)/g, ':id')   /* regex → :id */
    .replace(/\\/g, '');                     /* quitar backslashes */
}

/*
 * Busca un contrato por slug parcial del endpoint.
 * e.g. 'estadisticas' matchea 'admin/estadisticas'
 * e.g. 'vehiculos' matchea 'admin/vehiculos'
 */
export function buscarContratoPorSlug(slug: string): ContratoEndpoint | null {
  if (!cacheContratos) { return null; }

  /* Limpiar slug de comillas, backticks, template literals */
  const slugLimpio = slug.replace(/[`'"${}]/g, '').replace(/\?.*$/, '').replace(/\/+$/, '');

  for (const [ruta, contrato] of cacheContratos) {
    if (ruta.endsWith(slugLimpio) || ruta.includes(slugLimpio)) {
      return contrato;
    }
  }

  return null;
}
