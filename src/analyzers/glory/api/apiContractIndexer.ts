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

import * as path from 'path';
import * as fs from 'fs';
import { logInfo, logWarn } from '../../../utils/logger';
import { obtenerWorkspaceRoots } from '../../../core/seguridad-rutas/workspaceRoots';

/* Forma del valor de cada clave; la logica vive en apiContractShape.ts. */
import { inferirShapeValor, ShapeValor } from './apiContractShape';
export type { ShapeValor };

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
 * Rutas por defecto donde pueden vivir controllers PHP en el proyecto.
 * Se escanean todos en orden; `rutasGlory.controladores` del sentinel.config.json las sustituye.
 */
const RUTAS_CONTROLLERS_POR_DEFECTO: string[][] = [
  ['App', 'Api'],                               /* controllers generales */
  ['App', 'Kamples', 'Api', 'Controladores'],   /* controllers modulo Kamples */
];

let rutasControllers: string[][] = RUTAS_CONTROLLERS_POR_DEFECTO;

/* Lista vacia o ausente = defaults. Solo cambia la lista activa; `cargarContratos` la aplica al reindexar. */
export function configurarRutasControllers(rutas?: string[][]): void {
  rutasControllers = rutas && rutas.length > 0 ? rutas : RUTAS_CONTROLLERS_POR_DEFECTO;
}

export function obtenerRutasControllers(): string[][] {
  return rutasControllers;
}

/*
 * Escanea todos los *Controller.php en las rutas configuradas y construye el mapa.
 */
export function cargarContratos(): void {
  cacheContratos = new Map();

  for (const root of obtenerWorkspaceRoots()) {
    for (const segmentos of rutasControllers) {
      const rutaApi = path.join(root, ...segmentos);
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

export function recargarContratos(): void {
  logInfo('ApiContractIndexer: controller cambio, recargando...');
  cacheContratos = null;
  cargarContratos();
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

  let metodoActual: string | null = null;
  let profundidad = 0;
  let dentroDeMetodo = false;
  const metodosIndexados = new Set<string>(); /* evitar indexar el WP_REST_Response de error */

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Detectar inicio de metodo */
    const matchMetodo = regexMetodo.exec(linea);
    if (matchMetodo) {
      metodoActual = matchMetodo[1];
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

