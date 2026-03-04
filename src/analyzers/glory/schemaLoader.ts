/*
 * Carga y cacheo del Schema System de Glory (_generated/).
 * Parsea archivos *Cols.php y *Enums.php para construir mapas
 * de busqueda rapida usados por las reglas de hardcoded-sql-column
 * y hardcoded-enum-value.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {logInfo, logWarn} from '../../utils/logger';

/* Mapa de tabla -> { clase, columnas } para Cols */
export interface MapaCols {
    [tabla: string]: {
        clase: string;
        columnas: Map<string, string>;
    };
}

/* Mapa de valor enum -> { clase, constante } */
export interface EntradaEnum {
    clase: string;
    constante: string;
}

/* Cache del schema (se carga una vez al activar, se invalida con watcher) */
let cacheMapaCols: MapaCols | null = null;
let cacheMapaEnums: Map<string, EntradaEnum[]> | null = null;
let schemaWatcher: vscode.FileSystemWatcher | null = null;

/* Accessors para que otros modulos consulten el schema sin acoplarse al cache */
export function obtenerMapaCols(): MapaCols | null {
    return cacheMapaCols;
}
export function obtenerMapaEnums(): Map<string, EntradaEnum[]> | null {
    return cacheMapaEnums;
}

/*
 * Busca la carpeta _generated del Schema en el workspace.
 * Retorna la ruta absoluta o null si no existe.
 */
function buscarCarpetaGenerated(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        return null;
    }

    for (const folder of folders) {
        const ruta = path.join(folder.uri.fsPath, 'App', 'Config', 'Schema', '_generated');
        if (fs.existsSync(ruta)) {
            return ruta;
        }
    }
    return null;
}

/*
 * Parsea un archivo *Cols.php y extrae tabla + columnas.
 * Busca patrones: const TABLA = 'xxx'; y const NOMBRE = 'valor';
 */
function parsearArchivoCols(contenido: string): {tabla: string; clase: string; columnas: Map<string, string>} | null {
    const matchClase = contenido.match(/final\s+class\s+(\w+Cols)/);
    if (!matchClase) {
        return null;
    }

    const clase = matchClase[1];

    const matchTabla = contenido.match(/const\s+TABLA\s*=\s*'([^']+)'/);
    if (!matchTabla) {
        return null;
    }

    const tabla = matchTabla[1];
    const columnas = new Map<string, string>();

    /* Matchear todas las constantes excepto TABLA y TODAS */
    const regexConst = /const\s+([A-Z_]+)\s*=\s*'([^']+)'/g;
    let match: RegExpExecArray | null;
    while ((match = regexConst.exec(contenido)) !== null) {
        const nombre = match[1];
        const valor = match[2];
        if (nombre !== 'TABLA' && nombre !== 'TODAS') {
            columnas.set(valor, nombre);
        }
    }

    return {tabla, clase, columnas};
}

/*
 * Parsea un archivo *Enums.php y extrae constantes + valores.
 */
function parsearArchivoEnums(contenido: string): {clase: string; constantes: Map<string, string>} | null {
    const matchClase = contenido.match(/final\s+class\s+(\w+Enums)/);
    if (!matchClase) {
        return null;
    }

    const clase = matchClase[1];
    const constantes = new Map<string, string>();

    const regexConst = /const\s+([A-Z_]+)\s*=\s*'([^']+)'/g;
    let match: RegExpExecArray | null;
    while ((match = regexConst.exec(contenido)) !== null) {
        constantes.set(match[2], match[1]);
    }

    return {clase, constantes};
}

/*
 * Carga todos los Cols y Enums del directorio _generated.
 * Construye los mapas globales para busquedas rapidas.
 */
export function cargarSchema(): void {
    const carpeta = buscarCarpetaGenerated();
    if (!carpeta) {
        logWarn('GloryAnalyzer: No se encontro carpeta _generated del Schema.');
        return;
    }

    const mapaCols: MapaCols = {};
    const mapaEnums = new Map<string, EntradaEnum[]>();

    try {
        const archivos = fs.readdirSync(carpeta);

        for (const archivo of archivos) {
            const rutaCompleta = path.join(carpeta, archivo);
            const contenido = fs.readFileSync(rutaCompleta, 'utf-8');

            if (archivo.endsWith('Cols.php')) {
                const resultado = parsearArchivoCols(contenido);
                if (resultado) {
                    mapaCols[resultado.tabla] = {
                        clase: resultado.clase,
                        columnas: resultado.columnas
                    };
                }
            } else if (archivo.endsWith('Enums.php')) {
                const resultado = parsearArchivoEnums(contenido);
                if (resultado) {
                    for (const [valor, constante] of resultado.constantes) {
                        if (!mapaEnums.has(valor)) {
                            mapaEnums.set(valor, []);
                        }
                        mapaEnums.get(valor)!.push({
                            clase: resultado.clase,
                            constante
                        });
                    }
                }
            }
        }

        cacheMapaCols = mapaCols;
        cacheMapaEnums = mapaEnums;

        const totalTablas = Object.keys(mapaCols).length;
        const totalEnums = mapaEnums.size;
        logInfo(`GloryAnalyzer: Schema cargado — ${totalTablas} tablas (Cols), ${totalEnums} valores enum.`);
    } catch (err) {
        logWarn(`GloryAnalyzer: Error al cargar schema — ${err}`);
    }
}

/*
 * Inicializa el watcher del schema para invalidar cache
 * cuando se regeneran los archivos _generated.
 */
export function inicializarSchemaWatcher(context: vscode.ExtensionContext): void {
    cargarSchema();

    const carpeta = buscarCarpetaGenerated();
    if (carpeta) {
        const patron = new vscode.RelativePattern(carpeta, '*.php');
        schemaWatcher = vscode.workspace.createFileSystemWatcher(patron);

        const recargar = () => {
            logInfo('GloryAnalyzer: Schema _generated cambio, recargando...');
            cacheMapaCols = null;
            cacheMapaEnums = null;
            cargarSchema();
        };

        schemaWatcher.onDidChange(recargar);
        schemaWatcher.onDidCreate(recargar);
        schemaWatcher.onDidDelete(recargar);
        context.subscriptions.push(schemaWatcher);
    }
}
