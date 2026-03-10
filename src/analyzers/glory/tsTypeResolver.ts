/*
 * Resolvedor de tipos TypeScript importados.
 *
 * Lee archivos .ts de tipos (App/React/types/) y construye un indice:
 *   NombreTipo → { campo: { nombre, tipo, esArray } }
 *
 * Permite resolver tipos genericos importados como:
 *   useWordPressApi<VehiculoDetalleResponse>(...)
 * a sus campos concretos para cruzar con el indice PHP.
 *
 * Tambien detecta campos que son arrays (Type[]) para validar
 * que el PHP devuelva arrays indexados y no asociativos.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logInfo, logWarn } from '../../utils/logger';

/* Un campo de una interface/type TS */
export interface CampoTipo {
  nombre: string;
  tipoRaw: string;       /* e.g. 'VehiculoDetalle', 'string[]', 'PrecioTemporada[]' */
  esArray: boolean;       /* true si el tipo termina en [] o es Array<X> */
  tipoElemento: string;   /* Si esArray, el tipo del elemento (e.g. 'PrecioTemporada') */
  opcional: boolean;      /* true si el campo usa ? (e.g. campo?: Tipo) */
}

/* Definicion completa de un tipo TS */
export interface DefinicionTipo {
  nombre: string;
  campos: Map<string, CampoTipo>;
  extiende: string | null;  /* nombre del tipo padre si usa extends */
  archivo: string;
  linea: number;
}

let cacheTipos: Map<string, DefinicionTipo> | null = null;
let tipoWatcher: vscode.FileSystemWatcher | null = null;

/* Acceso publico al indice */
export function obtenerIndiceTipos(): Map<string, DefinicionTipo> | null {
  return cacheTipos;
}

/* Busca un tipo por nombre */
export function buscarTipo(nombre: string): DefinicionTipo | null {
  return cacheTipos?.get(nombre) ?? null;
}

/*
 * Resuelve un tipo hasta sus campos finales, siguiendo herencia (extends).
 * Retorna todos los campos incluyendo los heredados.
 */
export function resolverCamposTipo(nombre: string): Map<string, CampoTipo> | null {
  if (!cacheTipos) { return null; }

  const tipo = cacheTipos.get(nombre);
  if (!tipo) { return null; }

  const campos = new Map<string, CampoTipo>(tipo.campos);

  /* Resolver herencia */
  if (tipo.extiende) {
    const padresCampos = resolverCamposTipo(tipo.extiende);
    if (padresCampos) {
      for (const [k, v] of padresCampos) {
        if (!campos.has(k)) {
          campos.set(k, v);
        }
      }
    }
  }

  return campos;
}

/*
 * Inicializa el resolver: escanea archivos de tipos y configura watcher.
 */
export function inicializarTsTypeResolver(context: vscode.ExtensionContext): void {
  cargarTipos();

  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return; }

  for (const folder of folders) {
    const rutaTypes = path.join(folder.uri.fsPath, 'App', 'React', 'types');
    if (!fs.existsSync(rutaTypes)) { continue; }

    const patron = new vscode.RelativePattern(rutaTypes, '*.ts');
    tipoWatcher = vscode.workspace.createFileSystemWatcher(patron);

    const recargar = () => {
      logInfo('TsTypeResolver: archivo de tipos cambio, recargando...');
      cacheTipos = null;
      cargarTipos();
    };

    tipoWatcher.onDidChange(recargar);
    tipoWatcher.onDidCreate(recargar);
    tipoWatcher.onDidDelete(recargar);
    context.subscriptions.push(tipoWatcher);
    break;
  }
}

/*
 * Escanea archivos .ts en App/React/types/ y construye el indice de tipos.
 */
export function cargarTipos(): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return; }

  cacheTipos = new Map();

  for (const folder of folders) {
    const rutaTypes = path.join(folder.uri.fsPath, 'App', 'React', 'types');
    if (!fs.existsSync(rutaTypes)) { continue; }

    const archivos = fs.readdirSync(rutaTypes).filter(f => f.endsWith('.ts'));

    for (const archivo of archivos) {
      const rutaCompleta = path.join(rutaTypes, archivo);
      try {
        const contenido = fs.readFileSync(rutaCompleta, 'utf-8');
        indexarArchivoTipos(contenido, rutaCompleta);
      } catch (err) {
        logWarn(`TsTypeResolver: error al leer ${archivo} — ${err}`);
      }
    }
  }

  logInfo(`TsTypeResolver: ${cacheTipos.size} tipos indexados.`);
}

/*
 * Parsea interfaces y types de un archivo .ts.
 *
 * Soporta:
 *   export interface Foo { campo: Tipo; }
 *   export interface Bar extends Foo { otroCampo: Tipo[]; }
 *   export type Baz = { campo: Tipo; }
 */
function indexarArchivoTipos(contenido: string, rutaArchivo: string): void {
  if (!cacheTipos) { return; }

  const lineas = contenido.split('\n');

  /*
   * Regex para detectar inicio de interface/type:
   *   export interface NombreTipo [extends PadreTipo] {
   *   export type NombreTipo = {
   */
  const regexInterface = /^export\s+interface\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/;
  const regexType = /^export\s+type\s+(\w+)\s*=\s*\{/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    let nombre: string | null = null;
    let extiende: string | null = null;

    const matchInterface = regexInterface.exec(linea);
    if (matchInterface) {
      nombre = matchInterface[1];
      extiende = matchInterface[2] || null;
    }

    if (!nombre) {
      const matchType = regexType.exec(linea);
      if (matchType) {
        nombre = matchType[1];
      }
    }

    if (!nombre) { continue; }

    /* Parsear campos hasta el cierre de la llave } */
    const campos = new Map<string, CampoTipo>();
    let profundidad = 0;
    let inicioBloque = false;

    for (let j = i; j < lineas.length; j++) {
      const lineaCampo = lineas[j];

      /*
       * Extraer campo ANTES de contar llaves.
       * Sin esto, 'campo: Array<{' incrementa profundidad a 2
       * por el '{' inline, y el campo se pierde.
       */
      if (inicioBloque && profundidad === 1) {
        const campo = parsearCampo(lineaCampo);
        if (campo) {
          campos.set(campo.nombre, campo);
        }
      }

      for (const c of lineaCampo) {
        if (c === '{') { profundidad++; inicioBloque = true; }
        if (c === '}') { profundidad--; }
      }

      /* (campo ya extraido arriba) */

      if (inicioBloque && profundidad <= 0) { break; }
    }

    cacheTipos.set(nombre, {
      nombre,
      campos,
      extiende,
      archivo: rutaArchivo,
      linea: i,
    });
  }
}

/*
 * Parsea una linea de campo de interface/type.
 *
 * Soporta:
 *   nombre: string;
 *   campo?: Tipo[];
 *   items: Array<Tipo>;
 *   readonly campo: Tipo;
 */
function parsearCampo(linea: string): CampoTipo | null {
  const trim = linea.trim();

  /* Regex: captura nombre y tipo de un campo */
  const match = /^(?:readonly\s+)?(\w+)(\?)?\s*:\s*(.+?)\s*;?\s*$/.exec(trim);
  if (!match) { return null; }

  const nombre = match[1];
  const opcional = match[2] === '?';
  const tipoRaw = match[3].replace(/;$/, '').trim();

  /* Detectar si es array */
  const esArraySufijo = /\[\]\s*$/.test(tipoRaw);
  const matchArrayGeneric = /^Array<(.+)>$/.exec(tipoRaw);
  const esArray = esArraySufijo || !!matchArrayGeneric;

  let tipoElemento = '';
  if (esArraySufijo) {
    tipoElemento = tipoRaw.replace(/\[\]\s*$/, '');
  } else if (matchArrayGeneric) {
    tipoElemento = matchArrayGeneric[1];
  }

  return { nombre, tipoRaw, esArray, tipoElemento, opcional };
}
