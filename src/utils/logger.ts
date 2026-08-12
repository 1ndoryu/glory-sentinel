/*
 * Canal de output compartido para Code Sentinel.
 * Centraliza todos los logs de la extension en un unico Output Channel
 * visible en Ctrl+Shift+U -> "Code Sentinel".
 *
 * Separado en modulo propio para evitar dependencias circulares
 * y cumplir SRP: este archivo es la unica fuente del canal.
 */

import type * as vscode from 'vscode';
import { createRequire } from 'module';

const loadRuntimeModule = createRequire(__filename);

let canal: vscode.OutputChannel | null = null;

/* Inicializa el canal. Llamar una sola vez desde extension.ts al activar. */
export function inicializarCanal(context: vscode.ExtensionContext): vscode.OutputChannel {
    const vscodeApi = loadRuntimeModule('vscode') as typeof vscode;
    canal = vscodeApi.window.createOutputChannel('Code Sentinel');
    context.subscriptions.push(canal);
    return canal;
}

/* Registra un mensaje informativo con timestamp */
export function logInfo(mensaje: string): void {
    escribir('INFO', mensaje);
}

/* Registra un aviso */
export function logWarn(mensaje: string): void {
    escribir('WARN', mensaje);
}

/* Registra un error, opcionalmente con el objeto de error */
export function logError(mensaje: string, error?: unknown): void {
    escribir('ERROR', mensaje);
    if (error !== undefined) {
        const detalle = error instanceof Error
            ? `${error.message}${error.stack ? '\n' + error.stack : ''}`
            : String(error);
        escribir('ERROR', detalle);
    }
}

function escribir(nivel: string, mensaje: string): void {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const linea = `[${timestamp}] [${nivel}] ${mensaje}`;

    if (canal) {
        canal.appendLine(linea);
    } else {
        /* [108A-1 Fase 1] Fallback sin canal (p. ej. CLI en Node puro): los
         * diagnósticos van SIEMPRE a stderr. Usar console.log contaminaba
         * stdout con prefijos [INFO]/[WARN] antes del documento JSON
         * solicitado (sentinel analyze --format json | parser fallaba). En la
         * extensión VS Code el canal existe y esta rama no se ejecuta. */
        console.error(linea);
    }
}
