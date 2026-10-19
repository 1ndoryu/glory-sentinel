/*
 * Salida de logs compartida de Sentinel.
 *
 * El núcleo, la CLI y el LSP corren en Node puro, sin editor. Por eso este
 * módulo no importa `vscode`: la extensión crea su Output Channel y lo inyecta
 * con `instalarCanal`. Sin canal, los diagnósticos van a stderr.
 */

/* Lo mínimo que el logger necesita de un canal (el Output Channel de VS Code lo cumple). */
export interface CanalLog {
    appendLine(linea: string): void;
}

let canal: CanalLog | null = null;

/* Instala el canal de la extensión. Llamar una sola vez al activar; null lo quita (tests). */
export function instalarCanal(nuevo: CanalLog | null): void {
    canal = nuevo;
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
