/*
 * Carga y seguimiento de islas React registradas en appIslands.tsx
 * e inicializarIslands.ts. Usado por la regla isla-no-registrada
 * para detectar islas creadas pero no conectadas.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {Violacion} from '../../types';
import {obtenerSeveridadRegla} from '../../config/ruleRegistry';
import {logInfo, logWarn} from '../../utils/logger';

/* Cache de islas registradas en appIslands.tsx */
let cacheIslasRegistradas: Set<string> | null = null;

/* Accessor para verificar si una isla esta registrada */
export function islasRegistradasCargadas(): boolean {
    return cacheIslasRegistradas !== null;
}

/*
 * Carga las islas registradas en appIslands.tsx y config/inicializarIslands.ts.
 * Parsea imports y lazy-imports para construir el set de islas activas.
 * Soporta el sistema OCP donde islands se registran en inicializarIslands.ts
 * y se importan como side-effect desde appIslands.tsx.
 */
export function cargarIslasRegistradas(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        return;
    }

    for (const folder of folders) {
        const rutaApp = path.join(folder.uri.fsPath, 'App', 'React', 'appIslands.tsx');
        if (fs.existsSync(rutaApp)) {
            try {
                cacheIslasRegistradas = new Set<string>();

                /* Parsear appIslands.tsx */
                const contenido = fs.readFileSync(rutaApp, 'utf-8');
                parsearIslasDeContenido(contenido);

                /* Parsear config/inicializarIslands.ts (sistema OCP de auto-registro) */
                const rutaInicializar = path.join(folder.uri.fsPath, 'App', 'React', 'config', 'inicializarIslands.ts');
                if (fs.existsSync(rutaInicializar)) {
                    const contenidoInicializar = fs.readFileSync(rutaInicializar, 'utf-8');
                    parsearIslasDeContenido(contenidoInicializar);

                    /* Parsear llamadas a registrarIsland('NombreIsla', ...) */
                    const regexRegistrar = /registrarIsland\s*\(\s*['"](\w+)['"]/g;
                    let match: RegExpExecArray | null;
                    while ((match = regexRegistrar.exec(contenidoInicializar)) !== null) {
                        cacheIslasRegistradas.add(match[1]);
                    }
                }

                logInfo(`GloryAnalyzer: ${cacheIslasRegistradas.size} islas registradas en appIslands.tsx + inicializarIslands.ts.`);
            } catch (err) {
                logWarn(`GloryAnalyzer: Error al leer archivos de islas — ${err}`);
            }
            break;
        }
    }
}

/*
 * Parsea imports y registros de islas de un contenido de archivo.
 * Extrae nombres de islas de imports, lazy imports y registros en objetos.
 */
function parsearIslasDeContenido(contenido: string): void {
    if (!cacheIslasRegistradas) {
        return;
    }

    /* Imports: import {X} from './islands/X' o './islands/sub/X' */
    const regexImport = /import\s+.*from\s+['"]\.\.?\/islands\/(?:[\w/]+\/)?(\w+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = regexImport.exec(contenido)) !== null) {
        cacheIslasRegistradas.add(match[1]);
    }

    /* Lazy imports: lazy(() => import('./islands/sub/X')) */
    const regexLazy = /import\s*\(\s*['"]\.\.?\/islands\/(?:[\w/]+\/)?(\w+)['"]\s*\)/g;
    while ((match = regexLazy.exec(contenido)) !== null) {
        cacheIslasRegistradas.add(match[1]);
    }

    /* Registros en el objeto appIslands:
     * Con quotes: 'X': component o "X": component
     * Sin quotes: X: component (identifier key) */
    const regexRegistro = /(?:['"](\w+)['"]|(\w+))\s*:\s*\w+/g;
    while ((match = regexRegistro.exec(contenido)) !== null) {
        const nombre = match[1] || match[2];
        if (nombre && /^[A-Z]/.test(nombre)) {
            cacheIslasRegistradas.add(nombre);
        }
    }
}

/*
 * Inicializa los watchers de archivos de islas.
 */
export function inicializarIslasWatcher(context: vscode.ExtensionContext): void {
    cargarIslasRegistradas();

    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
        for (const folder of folders) {
            const rutaAppIslands = path.join(folder.uri.fsPath, 'App', 'React', 'appIslands.tsx');
            if (fs.existsSync(rutaAppIslands)) {
                const patronIslas = new vscode.RelativePattern(path.dirname(rutaAppIslands), 'appIslands.tsx');
                const islasWatcher = vscode.workspace.createFileSystemWatcher(patronIslas);

                const recargarIslas = () => {
                    logInfo('GloryAnalyzer: archivo de islas cambio, recargando...');
                    cacheIslasRegistradas = null;
                    cargarIslasRegistradas();
                };

                islasWatcher.onDidChange(recargarIslas);
                islasWatcher.onDidCreate(recargarIslas);
                context.subscriptions.push(islasWatcher);

                /* Watcher para config/inicializarIslands.ts (sistema OCP) */
                const rutaInicializar = path.join(folder.uri.fsPath, 'App', 'React', 'config', 'inicializarIslands.ts');
                if (fs.existsSync(rutaInicializar)) {
                    const patronInicializar = new vscode.RelativePattern(path.dirname(rutaInicializar), 'inicializarIslands.ts');
                    const inicializarWatcher = vscode.workspace.createFileSystemWatcher(patronInicializar);
                    inicializarWatcher.onDidChange(recargarIslas);
                    inicializarWatcher.onDidCreate(recargarIslas);
                    context.subscriptions.push(inicializarWatcher);
                }

                break;
            }
        }
    }
}

/*
 * Detecta archivos en islands/ que no estan registrados en appIslands.tsx.
 */
export function verificarIslaNoRegistrada(rutaArchivo: string, texto: string): Violacion[] {
    if (!cacheIslasRegistradas) {
        return [];
    }

    /* Respetar sentinel-disable a nivel de archivo */
    if (texto.includes('sentinel-disable isla-no-registrada')) {
        return [];
    }

    /* Solo verificar archivos dentro de islands/ */
    if (!rutaArchivo.includes('/islands/')) {
        return [];
    }

    /* Glory tiene su propio registro de islas (main.tsx), no usa appIslands.tsx */
    if (rutaArchivo.includes('/Glory/')) {
        return [];
    }

    const nombreArchivo = path.basename(rutaArchivo, path.extname(rutaArchivo));

    /* Excluir index, hooks, utils y archivos de componentes auxiliares */
    if (nombreArchivo === 'index' || /^use[A-Z]/.test(nombreArchivo) || nombreArchivo.startsWith('_') || nombreArchivo === 'types') {
        return [];
    }

    /* Excluir sub-componentes: archivos dentro de subdirectorios como
     * components/, hooks/, stores/, utils/, styles/, types/, constants/
     * NO son islas — son modulos internos importados por las islas.
     * Solo los archivos directamente en islands/ o islands/NombreIsla/
     * son candidatos a ser islas top-level. */
    const despuesIslands = rutaArchivo.split('/islands/')[1] || '';
    const segmentos = despuesIslands.split('/').filter(Boolean);
    if (segmentos.length > 2) {
        return [];
    }

    if (!cacheIslasRegistradas.has(nombreArchivo)) {
        return [
            {
                reglaId: 'isla-no-registrada',
                mensaje: `Isla '${nombreArchivo}' no esta registrada en appIslands.tsx. El componente no sera accesible.`,
                severidad: obtenerSeveridadRegla('isla-no-registrada'),
                linea: 0,
                sugerencia: `Agregar import y registro en App/React/appIslands.tsx para activar esta isla.`,
                fuente: 'estatico'
            }
        ];
    }

    return [];
}
