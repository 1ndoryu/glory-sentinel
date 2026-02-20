/*
 * Canal de output compartido para Code Sentinel.
 * Centraliza todos los logs de la extension en un unico Output Channel
 * visible en Ctrl+Shift+U -> "Code Sentinel".
 *
 * Separado en modulo propio para evitar dependencias circulares
 * y cumplir SRP: este archivo es la unica fuente del canal.
 */

import * as vscode from 'vscode';

let canal: vscode.OutputChannel | null = null;

/* Inicializa el canal. Llamar una sola vez desde extension.ts al activar. */
export function inicializarCanal(context: vscode.ExtensionContext): vscode.OutputChannel {
    canal = vscode.window.createOutputChannel('Code Sentinel');
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
        /* Fallback antes de que se inicialice (no deberia ocurrir normalmente) */
        console.log(linea);
    }
}
