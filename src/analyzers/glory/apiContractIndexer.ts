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

/*
 * Forma del valor de una clave en la respuesta PHP.
 * Permite distinguir si PHP devuelve un array indexado ([]) o asociativo ({}).
 */
export type ShapeValor = 'array_indexado' | 'array_asociativo' | 'escalar' | 'desconocido';

/* Tipo del contrato: endpoint → claves que devuelve el PHP */
export interface ContratoEndpoint {
  ruta: string;           /* e.g. '/admin/estadisticas' */
  metodo: string;         /* e.g. 'estadisticas' */
  claves: Set<string>;    /* top-level: ok, data, error... */
  payloadClaves: Set<string>; /* sub-claves dentro de data:{} — lo que TS realmente consume */
  shapes: Map<string, ShapeValor>;  /* clave → forma del valor */
  archivo: string;        /* ruta del controller */
  linea: number;          /* linea del WP_REST_Response */
}

let cacheContratos: Map<string, ContratoEndpoint> | null = null;

/* Acceso publico al indice */
export function obtenerContratos(): Map<string, ContratoEndpoint> | null {
  return cacheContratos;
}

/*
 * Rutas donde pueden vivir controllers PHP en el proyecto.
 * Se escanean todos en orden. Si el proyecto crece con nuevas
 * ubicaciones, agregarlas aqui.
 */
const RUTAS_CONTROLLERS = [
  ['App', 'Api'],                               /* controllers generales */
  ['App', 'Kamples', 'Api', 'Controladores'],   /* controllers modulo Kamples */
];

/*
 * Inicializa el indexer: escanea todos los directorios de controllers
 * y configura watchers para cada uno.
 */
export function inicializarApiContractIndexer(context: vscode.ExtensionContext): void {
  cargarContratos();

  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return; }

  for (const folder of folders) {
    for (const segmentos of RUTAS_CONTROLLERS) {
      const rutaApi = path.join(folder.uri.fsPath, ...segmentos);
      if (!fs.existsSync(rutaApi)) { continue; }

      const patron = new vscode.RelativePattern(rutaApi, '*Controller.php');
      const watcher = vscode.workspace.createFileSystemWatcher(patron);

      const recargar = () => {
        logInfo('ApiContractIndexer: controller cambio, recargando...');
        cacheContratos = null;
        cargarContratos();
      };

      watcher.onDidChange(recargar);
      watcher.onDidCreate(recargar);
      watcher.onDidDelete(recargar);
      context.subscriptions.push(watcher);
    }
    /* Solo procesar el primer workspace folder */
    break;
  }
}

/*
 * Escanea todos los *Controller.php en las rutas configuradas y construye el mapa.
 */
export function cargarContratos(): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return; }

  cacheContratos = new Map();

  for (const folder of folders) {
    for (const segmentos of RUTAS_CONTROLLERS) {
      const rutaApi = path.join(folder.uri.fsPath, ...segmentos);
      if (!fs.existsSync(rutaApi)) { continue; }

      const archivos = readdirRecursivo(rutaApi)
        .filter(f => f.endsWith('Controller.php'));

      for (const archivo of archivos) {
        try {
          const contenido = fs.readFileSync(archivo, 'utf-8');
          indexarController(contenido, archivo);
        } catch (err) {
          logWarn(`ApiContractIndexer: error al leer ${archivo} — ${err}`);
        }
      }
    }
  }

  logInfo(`ApiContractIndexer: ${cacheContratos.size} endpoints indexados.`);
}

/*
 * Devuelve todas las rutas de archivos en un directorio de forma recursiva.
 * Necesario porque Kamples tiene subdirectorios dentro de Api/Controladores/.
 */
function readdirRecursivo(dir: string): string[] {
  const resultados: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      resultados.push(...readdirRecursivo(ruta));
    } else {
      resultados.push(ruta);
    }
  }
  return resultados;
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
  /*
   * regexRuta: soporta tanto namespace como string literal o variable $var.
   * Ej: register_rest_route('ns', '/path') o \register_rest_route($namespace, '/path')
   */
  const regexRuta = /register_rest_route\s*\(\s*(?:['"][^'"]+['"]|\$\w+)\s*,\s*['"]([^'"]+)['"]/;
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
  /* Soporta new WP_REST_Response([ y new \WP_REST_Response([ */
  const regexResponse = /new\s+\\?WP_REST_Response\s*\(\[/;
  const regexClave = /['"](\w+)['"]\s*=>/;

  let metodoActual: string | null = null;
  let metodoLinea = 0;
  let profundidad = 0;
  let dentroDeMetodo = false;
  const metodosIndexados = new Set<string>(); /* evitar indexar el WP_REST_Response de error */

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
    if (metodosIndexados.has(metodoActual)) { continue; } /* ya indexado, saltar response de error */
    if (!regexResponse.test(linea)) { continue; }

    /* Solo tomar el primer WP_REST_Response con status 200 (exito) */
    const ruta = rutaMetodo.get(metodoActual);
    if (!ruta) { continue; }

    /* Extraer claves del array asociativo en las proximas lineas */
    const claves = new Set<string>();
    const payloadClaves = new Set<string>(); /* sub-claves dentro de data:{} */
    const shapes = new Map<string, ShapeValor>();
    let profArray = 0;
    let inicioArray = false;

    for (let j = i; j < Math.min(i + 40, lineas.length); j++) {
      const lineaResp = lineas[j];

      /*
       * Extraer claves ANTES de contar brackets.
       * Sin esto, 'data' => [ incrementa profArray a 2
       * por el [ inline, y 'data' se pierde del nivel 1.
       */
      if (inicioArray && profArray === 1) {
        for (const m of lineaResp.matchAll(/['"]\w+['"]\s*=>/g)) {
          const matchClave = /['"]([\w]+)['"]\s*=>/.exec(m[0]);
          if (matchClave) {
            const clave = matchClave[1];
            claves.add(clave);
            shapes.set(clave, inferirShapeValor(lineaResp, lineas, j, contenido));
          }
        }
      }

      /* Sub-claves nivel 2: extraer ANTES de contar brackets (misma razon) */
      if (inicioArray && profArray === 2) {
        for (const m of lineaResp.matchAll(/['"]([\w]+)['"]\s*=>/g)) {
          payloadClaves.add(m[1]);
        }
      }

      /* Contar brackets DESPUES de extraer claves */
      for (const c of lineaResp) {
        if (c === '[') { profArray++; inicioArray = true; }
        if (c === ']') { profArray--; }
      }

      /* Fin del array principal */
      if (inicioArray && profArray <= 0) { break; }
    }

    /*
     * Saltar respuestas que solo contienen claves de error (code, error, message, status).
     * Estas son responses de catch/validacion, no el payload real del endpoint.
     * No agregarlas a metodosIndexados permite que el response de exito posterior se indexe.
     */
    /*
     * Claves tipicas de respuestas de error. 'success' se incluye porque TODAS las
     * respuestas (exito y error) lo traen — sin incluirlo, ['success'=>false,'error'=>'...']
     * no se clasifica como error y se indexa en vez del success response real.
     */
    const CLAVES_ERROR = new Set(['code', 'error', 'message', 'status', 'success']);
    const esErrorResponse = claves.size > 0 && [...claves].every(c => CLAVES_ERROR.has(c));

    if (claves.size > 0 && !esErrorResponse) {
      /* Normalizar ruta: quitar regex de params y namespace */
      const rutaNorm = normalizarRutaEndpoint(ruta);
      cacheContratos.set(rutaNorm, {
        ruta: rutaNorm,
        metodo: metodoActual,
        claves,
        payloadClaves,
        shapes,
        archivo: rutaArchivo,
        linea: i,
      });
      /* Marcar metodo como indexado para saltar su WP_REST_Response de error */
      metodosIndexados.add(metodoActual);
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

/*
 * Busca un contrato por ruta completa del endpoint REST.
 * e.g. '/glory/v1/vehiculos/slug/:slug' matchea 'vehiculos/slug/:id'
 */
export function buscarContratoPorRuta(rutaEndpoint: string): ContratoEndpoint | null {
  if (!cacheContratos) { return null; }

  /* Normalizar: quitar namespace, barras iniciales, params */
  const normalizada = rutaEndpoint
    .replace(/^\/?(glory\/v\d+\/)/, '')
    .replace(/\$\{[^}]+\}/g, ':id')
    .replace(/\/+$/, '');

  const segNorm = normalizada.split('/').filter(Boolean);

  /* Fase 1: match exacto */
  for (const [ruta, contrato] of cacheContratos) {
    if (ruta === normalizada) { return contrato; }
  }

  /* Fase 2: match con misma cantidad de segmentos (priorizar especificidad) */
  let mejorMatch: ContratoEndpoint | null = null;
  let mejorScore = 0;

  for (const [ruta, contrato] of cacheContratos) {
    const segRuta = ruta.split('/').filter(Boolean);

    /* Solo considerar rutas con la misma cantidad de segmentos */
    if (segRuta.length !== segNorm.length) { continue; }

    /* Contar segmentos que coinciden (excluyendo :id que matchea cualquier cosa) */
    let score = 0;
    let compatible = true;
    for (let s = 0; s < segRuta.length; s++) {
      if (segRuta[s] === segNorm[s]) {
        score += 2; /* match exacto */
      } else if (segRuta[s] === ':id' && segNorm[s] === ':id') {
        score += 2; /* ambos dinamicos — match estructural */
      } else if (segRuta[s] === ':id') {
        score += 1; /* PHP dinamico, TS literal — valido */
      } else if (segNorm[s] === ':id') {
        compatible = false; /* TS dinamico vs PHP literal — match incorrecto */
        break;
      } else {
        compatible = false;
        break;
      }
    }

    if (compatible && score > mejorScore) {
      mejorScore = score;
      mejorMatch = contrato;
    }
  }

  if (mejorMatch) { return mejorMatch; }

  /* Fase 3: match parcial por sufijo (solo si no hay match por segmentos) */
  for (const [ruta, contrato] of cacheContratos) {
    if (ruta.endsWith(normalizada) || normalizada.endsWith(ruta)) {
      return contrato;
    }
  }

  return null;
}

/*
 * Infiere la forma (shape) del valor de una clave en WP_REST_Response.
 *
 * Detecta patrones PHP para distinguir:
 * - array_indexado:     $data['key'] = $array (donde $array se llena con $arr[] = ...)
 *                       'key' => array_map(...)
 *                       'key' => $variable (donde $variable viene de metodo que retorna [])
 * - array_asociativo:   'key' => $data (donde $data se llena con $data[$k] = ...)
 *                       'key' => ['clave' => valor, ...]
 * - escalar:            'key' => (int), (float), (string), count(), true/false
 * - desconocido:        no se puede determinar
 */
function inferirShapeValor(lineaResp: string, lineas: string[], lineaIdx: number, contenidoCompleto: string): ShapeValor {
  /* Extraer la parte del valor: 'clave' => VALOR */
  const matchValor = /['"]\w+['"]\s*=>\s*(.+?)\s*,?\s*$/.exec(lineaResp.trim());
  if (!matchValor) { return 'desconocido'; }
  const valor = matchValor[1].trim();

  /* Escalares directos */
  if (/^\(int\)|^\(float\)|^\(string\)|^\(bool\)|^count\(|^(true|false|null)\b|^['"]|^\d+/.test(valor)) {
    return 'escalar';
  }

  /* Array literal inline con claves string: ['clave' => ...] */
  if (/^\[/.test(valor) && /['"]\w+['"]\s*=>/.test(valor)) {
    return 'array_asociativo';
  }

  /* array_map / array_values / array_filter → generalmente array indexado */
  if (/^array_map\(|^array_values\(|^array_filter\(/.test(valor)) {
    return 'array_indexado';
  }

  /* Variable: rastrear como se construye en el metodo */
  const matchVar = /^\$(\w+)/.exec(valor);
  if (matchVar) {
    return rastrearShapeVariable(matchVar[1], lineas, lineaIdx);
  }

  /* Llamada a metodo estatico/instancia: rastrear retorno */
  const matchMetodo = /(\w+)::(\w+)\(|->(\w+)\(/.exec(valor);
  if (matchMetodo) {
    const nombreMetodo = matchMetodo[2] || matchMetodo[3];
    return rastrearShapeMetodo(nombreMetodo, contenidoCompleto);
  }

  return 'desconocido';
}

/*
 * Rastrea como se construye una variable PHP dentro del metodo actual.
 *
 * Busca hacia arriba desde la linea de referencia:
 * - $var[] = ...           → array_indexado
 * - $var[$key] = ...       → array_asociativo
 * - $var = []              → depende del uso posterior
 * - $var = array_map(...)  → array_indexado
 */
function rastrearShapeVariable(nombre: string, lineas: string[], desdeLinea: number): ShapeValor {
  const escapado = nombre.replace(/\$/g, '\\$');

  let tieneAppend = false;        /* $var[] = ... */
  let tieneClaveAsociativa = false; /* $var[$key] = ... */
  let tieneArrayMap = false;       /* $var = array_map(...) */

  /* Buscar hacia arriba, maximo 100 lineas */
  const inicio = Math.max(0, desdeLinea - 100);
  for (let i = inicio; i < desdeLinea; i++) {
    const linea = lineas[i];

    /* $var[] = valor → append indexado */
    if (new RegExp(`\\$${escapado}\\[\\]\\s*=`).test(linea)) {
      tieneAppend = true;
    }

    /* $var[$key] = valor → asociativo (donde $key no es vacio) */
    if (new RegExp(`\\$${escapado}\\[\\$\\w+\\]\\s*=|\\$${escapado}\\[['"]\\w+['"]\\]\\s*=`).test(linea)) {
      tieneClaveAsociativa = true;
    }

    /* $var = array_map(...) */
    if (new RegExp(`\\$${escapado}\\s*=\\s*array_map\\(`).test(linea)) {
      tieneArrayMap = true;
    }
  }

  if (tieneArrayMap || tieneAppend) { return 'array_indexado'; }
  if (tieneClaveAsociativa) { return 'array_asociativo'; }

  return 'desconocido';
}

/*
 * Rastrea la forma del retorno de un metodo PHP dentro del mismo archivo.
 *
 * Busca:
 * - function nombre(): array con $result[] = ... → array_indexado
 * - function nombre(): array con $result[$k] = ... → array_asociativo
 */
function rastrearShapeMetodo(nombre: string, contenido: string): ShapeValor {
  const regexMetodo = new RegExp(`function\\s+${nombre}\\s*\\([^)]*\\)[^{]*\\{`, 's');
  const matchMetodo = regexMetodo.exec(contenido);
  if (!matchMetodo) { return 'desconocido'; }

  /* Extraer cuerpo del metodo (hasta profundidad 0) */
  const inicio = matchMetodo.index + matchMetodo[0].length;
  let profundidad = 1;
  let fin = inicio;
  for (let i = inicio; i < contenido.length && profundidad > 0; i++) {
    if (contenido[i] === '{') { profundidad++; }
    if (contenido[i] === '}') { profundidad--; }
    fin = i;
  }

  const cuerpo = contenido.slice(inicio, fin);

  const tieneAppend = /\$\w+\[\]\s*=/.test(cuerpo);
  const tieneAsociativo = /\$\w+\[\$\w+\]\s*=|\$\w+\[['"]/.test(cuerpo);

  /* Si tiene ambos, el asociativo gana (es el patron que causa bugs) */
  if (tieneAsociativo && !tieneAppend) { return 'array_asociativo'; }
  if (tieneAppend && !tieneAsociativo) { return 'array_indexado'; }
  if (/array_map\(/.test(cuerpo)) { return 'array_indexado'; }

  return 'desconocido';
}
