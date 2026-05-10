/*
 * Indexador de constantes de clase PHP del workspace.
 * Escanea archivos PHP en App/ y Glory/src/ al activar la extension,
 * construye un mapa className -> Set<constName> para validacion
 * cross-file de referencias a constantes (self::, ClassName::, etc).
 *
 * El watcher vive en el adaptador de editor; este modulo solo carga y actualiza indices.
 */

import * as path from 'path';
import * as fs from 'fs';
import { logInfo } from '../../utils/logger';
import { obtenerWorkspaceRoots } from '../../core/workspaceRoots';

/* Informacion indexada de una clase PHP */
interface InfoClase {
  constantes: Set<string>;
  extends: string | null;
}

/* Cache principal: className -> InfoClase */
let cacheConstantes: Map<string, InfoClase> | null = null;

/* Accessor publico */
export function obtenerIndiceConstantes(): Map<string, InfoClase> | null {
  return cacheConstantes;
}

/*
 * Inyecta un indice de constantes para tests unitarios.
 * Permite verificar reglas sin escanear el filesystem.
 */
export function setearIndiceParaTests(mapa: Map<string, { constantes: Set<string>; extends: string | null }>): void {
  cacheConstantes = mapa;
}

/*
 * Dado un nombre corto de clase, retorna el Set de constantes definidas.
 * Resuelve herencia de un nivel (extends), consultando tambien la clase padre.
 */
export function obtenerConstantesDeClase(nombreClase: string): Set<string> | null {
  if (!cacheConstantes) { return null; }

  const info = cacheConstantes.get(nombreClase);
  if (!info) { return null; }

  /* Combinar constantes propias + heredadas (1 nivel) */
  const resultado = new Set(info.constantes);

  if (info.extends) {
    const padre = cacheConstantes.get(info.extends);
    if (padre) {
      for (const c of padre.constantes) {
        resultado.add(c);
      }
    }
  }

  return resultado;
}

/* Carpetas a escanear (relativas al workspace root) */
const CARPETAS_ESCANEO = ['App', path.join('Glory', 'src')];

/* Carpetas a excluir */
const CARPETAS_EXCLUIDAS = new Set(['vendor', 'node_modules', '_generated']);

/*
 * Parsea un archivo PHP y extrae el nombre de clase, sus constantes y herencia.
 * Retorna null si el archivo no define una clase.
 */
function parsearArchivoPhp(contenido: string): { clase: string; info: InfoClase } | null {
  /* Extraer nombre de clase (soporta final class, abstract class, class) */
  const matchClase = contenido.match(/(?:final|abstract)?\s*class\s+(\w+)(?:\s+extends\s+(\w+))?/);
  if (!matchClase) { return null; }

  const clase = matchClase[1];
  const extiende = matchClase[2] || null;

  /* Extraer todas las constantes: const NOMBRE = ... ; */
  const constantes = new Set<string>();
  const regexConst = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=/g;
  let match: RegExpExecArray | null;
  while ((match = regexConst.exec(contenido)) !== null) {
    constantes.add(match[1]);
  }

  return { clase, info: { constantes, extends: extiende } };
}

/*
 * Escanea recursivamente un directorio, parseando cada .php.
 */
function escanearDirectorio(ruta: string, mapa: Map<string, InfoClase>): void {
  try {
    const entradas = fs.readdirSync(ruta, { withFileTypes: true });

    for (const entrada of entradas) {
      if (CARPETAS_EXCLUIDAS.has(entrada.name)) { continue; }

      const rutaCompleta = path.join(ruta, entrada.name);

      if (entrada.isDirectory()) {
        escanearDirectorio(rutaCompleta, mapa);
      } else if (entrada.name.endsWith('.php')) {
        try {
          const contenido = fs.readFileSync(rutaCompleta, 'utf-8');
          const resultado = parsearArchivoPhp(contenido);
          if (resultado && resultado.info.constantes.size > 0) {
            mapa.set(resultado.clase, resultado.info);
          }
        } catch {
          /* Archivo no legible, skip silencioso */
        }
      }
    }
  } catch {
    /* Directorio no legible, skip silencioso */
  }
}

/*
 * Tambien indexa _generated/ por separado (estos son criticos para el Schema System).
 */
function escanearGenerated(workspaceRoot: string, mapa: Map<string, InfoClase>): void {
  const rutaGenerated = path.join(workspaceRoot, 'App', 'Config', 'Schema', '_generated');
  if (!fs.existsSync(rutaGenerated)) { return; }

  try {
    const archivos = fs.readdirSync(rutaGenerated);
    for (const archivo of archivos) {
      if (!archivo.endsWith('.php')) { continue; }
      try {
        const contenido = fs.readFileSync(path.join(rutaGenerated, archivo), 'utf-8');
        const resultado = parsearArchivoPhp(contenido);
        if (resultado) {
          /* Incluso si no tiene constantes propias explicitamente, registrar la clase */
          mapa.set(resultado.clase, resultado.info);
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
}

/*
 * Carga el indice completo de constantes PHP del workspace.
 */
export function cargarIndiceConstantes(): void {
  const mapa = new Map<string, InfoClase>();

  for (const root of obtenerWorkspaceRoots()) {
    /* Escanear carpetas principales del proyecto */
    for (const carpeta of CARPETAS_ESCANEO) {
      const ruta = path.join(root, carpeta);
      if (fs.existsSync(ruta)) {
        escanearDirectorio(ruta, mapa);
      }
    }

    /* Escanear _generated separadamente (normalmente excluido por CARPETAS_EXCLUIDAS) */
    escanearGenerated(root, mapa);
  }

  cacheConstantes = mapa;

  const totalClases = mapa.size;
  let totalConstantes = 0;
  for (const info of mapa.values()) {
    totalConstantes += info.constantes.size;
  }
  logInfo(`ConstantIndexer: ${totalClases} clases indexadas, ${totalConstantes} constantes totales.`);
}

/*
 * Actualiza el indice para un solo archivo que cambio.
 * Mas eficiente que reindexar todo el workspace.
 */
export function actualizarArchivoEnIndice(rutaArchivo: string): void {
  if (!cacheConstantes) {
    cargarIndiceConstantes();
    return;
  }

  try {
    if (!fs.existsSync(rutaArchivo)) {
      /* Archivo eliminado: buscar y eliminar la entrada correspondiente */
      /* No sabemos que clase estaba ahi, asi que reindexamos (poco frecuente) */
      cargarIndiceConstantes();
      return;
    }

    const contenido = fs.readFileSync(rutaArchivo, 'utf-8');
    const resultado = parsearArchivoPhp(contenido);

    if (resultado) {
      cacheConstantes.set(resultado.clase, resultado.info);
    }
  } catch {
    /* Si falla la lectura, reindexar por seguridad */
    cargarIndiceConstantes();
  }
}

export function recargarIndiceConstantes(): void {
  logInfo('ConstantIndexer: _generated cambio, recargando indice...');
  cargarIndiceConstantes();
}
