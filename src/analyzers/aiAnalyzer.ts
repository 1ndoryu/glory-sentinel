/*
 * Motor de analisis con IA via vscode.lm API.
 * Envia el contenido del archivo junto con prompts segmentados
 * al modelo de IA y parsea las violaciones detectadas.
 */

import * as vscode from 'vscode';
import {Violacion, ViolacionIA, RespuestaIA, obtenerTipoArchivo} from '../types';
import {construirPrompt} from '../config/prompts';
import {logInfo, logWarn, logError} from '../utils/logger';
import {spawn, type ChildProcessWithoutNullStreams} from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

/* Referencia al modelo seleccionado (se cachea tras la primera seleccion) */
let modeloCache: vscode.LanguageModelChat | null = null;

/*
 * Opciones para controlar el backend de IA (copilot o gemini-cli).
 */
export interface OpcionesIA {
    /* 'copilot' | 'gemini-cli' */
    aiBackend: string;
    geminiModel: string;
}

/*
 * Analiza un documento usando IA para detectar violaciones semanticas.
 * Retorna array de violaciones si el analisis completo exitosamente (puede ser vacio),
 * o null si el analisis fallo (timeout, error de red, modelo no disponible).
 * Si se proporcionan reglasCustom, se inyectan en el prompt como contexto adicional.
 * opcionesIA controla si se usa Gemini CLI o la API de vscode.lm, y que modelo Gemini.
 */
export async function analizarConIA(documento: vscode.TextDocument, modelFamily: string, timeoutMs: number, cancelToken?: vscode.CancellationToken, reglasCustom?: string, opcionesIA?: OpcionesIA): Promise<Violacion[] | null> {
    try {
        /* Determinar si usar Gemini CLI: por config explicita ('gemini-cli') o autodeteccion Antigravity */
        const usarGeminiCli = opcionesIA?.aiBackend === 'gemini-cli'
            || vscode.env.appName.toLowerCase().includes('antigravity');
        const geminiModel = opcionesIA?.geminiModel || 'flash-min';

        /* Solo obtener modelo del IDE si NO se usa Gemini CLI */
        let modelo: vscode.LanguageModelChat | null = null;
        if (!usarGeminiCli) {
            modelo = await obtenerModelo(modelFamily);
            if (!modelo) {
                return null;
            }
        }

        const tipoArchivo = obtenerTipoArchivo(documento.languageId, documento.fileName);
        const textoArchivo = documento.getText();

        /* No enviar archivos demasiado grandes */
        if (textoArchivo.length > 100 * 1024) {
            return null;
        }

        logInfo(`Analizando con IA: ${documento.fileName.split(/[\\/]/).pop()} (tipo: ${tipoArchivo})`);

        const prompt = construirPrompt(tipoArchivo, textoArchivo, reglasCustom);
        const mensajes = [vscode.LanguageModelChatMessage.User(prompt)];

        /* Ejecutar con Gemini CLI o vscode.lm segun configuracion */
        let respuesta: string | null = null;
        if (usarGeminiCli) {
            logInfo(`Usando Gemini CLI (modelo: ${geminiModel})...`);
            respuesta = await ejecutarConGeminiCli(prompt, geminiModel, timeoutMs, cancelToken);
        } else {
            respuesta = await ejecutarConTimeout(modelo as vscode.LanguageModelChat, mensajes, timeoutMs, cancelToken);
        }

        if (!respuesta) {
            logWarn('La IA no devolvio respuesta (timeout o error de red).');
            return null;
        }

        /* Parsear respuesta JSON */
        const violacionesIA = parsearRespuesta(respuesta);
        if (!violacionesIA.length) {
            logInfo('IA: sin violaciones detectadas.');
            return [];
        }

        logInfo(`IA: ${violacionesIA.length} violacion(es) detectada(s).`);

        /* Filtrar falsos positivos conocidos con validacion deterministica local */
        const violacionesNormalizadas = filtrarViolacionesInconsistentes(violacionesIA, documento.lineCount);

        /* Descartar reglas donde el análisis estático ya proporciona cobertura
         * exacta y sin falsos positivos, o donde la IA produce false positives
         * estructurales que no puede resolver sin ejecutar el código.
         *
         * - catch-vacio: el regex estático detecta catches realmente vacíos. La IA
         *   confunde catches multilinea con contenido (PHP/TS) al ver la llave de
         *   apertura en la misma línea del catch.
         * - fallo-sin-feedback: la IA no puede verificar si el catch llama a setEstado,
         *   muestra un toast, redirige, etc. siempre genera falso positivo.
         * - try-catch-faltante-ts: la IA reporta esto cuando el fetch SÍ está en
         *   try-catch, no ve el bloque completo del useEffect.
         */
        const REGLAS_CUBIERTAS_POR_ESTATICO = new Set([
            'catch-vacio',
            'fallo-sin-feedback',
            'try-catch-faltante-ts',
            /* La IA no puede distinguir funciones void de funciones con contrato
             * { ok: bool }. En void functions el catch sin return no es error-enmascarado. */
            'error-enmascarado',
            /* La IA confunde el patrón de input controlado (setState en onChange) con
             * un update optimista. Un update optimista real requiere analizar si el
             * estado modificado representa datos persistidos vs. estado de formulario local.
             * Sin análisis de tipos/flujo de datos es imposible distinguirlos de forma fiable. */
            'update-optimista-sin-rollback'
        ]);
        const violacionesFinal = violacionesNormalizadas.filter(v => !REGLAS_CUBIERTAS_POR_ESTATICO.has((v.regla || '').toLowerCase()));

        /* Convertir violaciones IA a formato interno, validando rangos */
        const totalLineas = documento.lineCount;
        return violacionesFinal
            .filter(v => v.linea >= 1 && v.linea <= totalLineas)
            .map(v => ({
                reglaId: v.regla || 'ia-general',
                mensaje: v.mensaje,
                severidad: v.severidad || 'warning',
                linea: v.linea - 1,
                lineaFin: typeof v.lineaFin === 'number' ? Math.max(v.linea, v.lineaFin) - 1 : undefined,
                sugerencia: v.sugerencia,
                fuente: 'ia' as const
            }));
    } catch (error) {
        /* Graceful degradation: si la IA falla, la extension sigue funcionando con reglas estaticas */
        logError('Error en analisis IA', error);
        return null;
    }
}

/* Obtiene o cachea el modelo de IA via vscode.lm API */
async function obtenerModelo(modelFamily: string): Promise<vscode.LanguageModelChat | null> {
    if (modeloCache) {
        return modeloCache;
    }

    try {
        const opcionesModelo: vscode.LanguageModelChatSelector = {
            vendor: 'copilot',
            family: modelFamily
        };

        const modelos = await vscode.lm.selectChatModels(opcionesModelo);

        if (modelos.length === 0) {
            logWarn(`Modelo ${modelFamily} no disponible. Analisis IA desactivado.`);
            try {
                const todosLosModelos = await vscode.lm.selectChatModels({});
                const lista = todosLosModelos.map(m => `[vendor: ${m.vendor}, family: ${m.family}, id: ${m.id}, name: ${m.name}]`).join('\n  - ');
                logInfo(`Modelos disponibles en sistema:\n  - ${lista || 'NINGUNO'}`);
            } catch (e) {}
            return null;
        }

        modeloCache = modelos[0];
        logInfo(`Modelo ${modeloCache.name} seleccionado correctamente.`);
        return modeloCache;
    } catch (error) {
        logError('Error seleccionando modelo de IA', error);
        return null;
    }
}

/* Ejecuta el analisis usando Gemini CLI directamente.
 * Escribe el prompt en un archivo temporal y lo pasa por stdin para evitar
 * el limite de longitud de la linea de comandos de Windows (~8191 chars).
 * Usa -p "." solo como trigger de modo headless; el contenido real viene de stdin. */
async function ejecutarConGeminiCli(prompt: string, geminiModel: string, timeoutMs: number, cancelToken?: vscode.CancellationToken): Promise<string | null> {
    /* Escribir prompt a archivo temporal — evita limite de cmd.exe en Windows */
    const tmpFile = path.join(os.tmpdir(), `sentinel-prompt-${Date.now()}.txt`);
    try {
        fs.writeFileSync(tmpFile, prompt, 'utf8');
    } catch (e) {
        logError('No se pudo escribir archivo temporal para Gemini CLI', e);
        return null;
    }

    return new Promise(resolve => {
        let resuelta = false;
        let child: ChildProcessWithoutNullStreams | null = null;
        let stdinStream: fs.ReadStream | null = null;
        const inicioMs = Date.now();
        let bytesStdout = 0;
        let bytesStderr = 0;
        let primerChunkRecibido = false;

        const limpiarTmp = () => {
            try { fs.unlinkSync(tmpFile); } catch (_) {}
        };

        const matarProcesoGemini = () => {
            if (!child) {
                return;
            }

            try {
                stdinStream?.unpipe(child.stdin);
            } catch (_) {}

            try {
                stdinStream?.destroy();
            } catch (_) {}

            try {
                child.stdin.end();
            } catch (_) {}

            if (child.killed) {
                return;
            }

            if (os.platform() === 'win32' && typeof child.pid === 'number') {
                try {
                    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
                        shell: false,
                        windowsHide: true,
                        stdio: 'ignore'
                    });
                } catch (_) {
                    try { child.kill(); } catch (_) {}
                }
            } else {
                try { child.kill('SIGKILL'); } catch (_) {}
            }
        };

        const timer = setTimeout(() => {
            if (!resuelta) {
                resuelta = true;
                matarProcesoGemini();
                limpiarTmp();
                logWarn(`Timeout en request Gemini CLI (${timeoutMs}ms). Cancelando...`);
                resolve(null);
            }
        }, timeoutMs);

        const timerHeartbeat = setInterval(() => {
            if (!resuelta) {
                const transcurrido = Date.now() - inicioMs;
                logInfo(`Gemini CLI sigue en ejecucion (${transcurrido}ms, stdout: ${bytesStdout} bytes, stderr: ${bytesStderr} bytes).`);
            }
        }, 10_000);

        try {
            /* -p "." activa modo headless; el prompt completo llega por stdin.
             * shell:true necesario en Windows para resolver 'gemini' desde PATH.
             * La linea de comando es corta ("-p .") asi que no choca con el limite de cmd.exe. */
            const args = ['-m', geminiModel, '-p', '.', '--approval-mode', 'plan', '--output-format', 'text'];
            logInfo(`Lanzando: gemini -m ${geminiModel} -p . --approval-mode plan --output-format text < [prompt ${prompt.length} chars desde tmpfile]`);

            child = spawn('gemini', args, {
                shell: os.platform() === 'win32',
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            }) as ChildProcessWithoutNullStreams;

            logInfo(`Gemini CLI PID: ${child.pid ?? 'N/A'}`);

            /* Pipar el archivo temporal al stdin del child */
            stdinStream = fs.createReadStream(tmpFile, 'utf8');
            stdinStream.pipe(child.stdin);
            stdinStream.on('end', () => {
                try { child?.stdin.end(); } catch (_) {}
            });
            stdinStream.on('error', (err) => {
                if (!resuelta) {
                    resuelta = true;
                    clearTimeout(timer);
                    clearInterval(timerHeartbeat);
                    matarProcesoGemini();
                    limpiarTmp();
                    logError('Error leyendo tmp prompt para Gemini CLI', err);
                    resolve(null);
                }
            });

            let output = '';
            let errorOut = '';

            child.stdout.on('data', d => {
                const chunk = d.toString();
                output += chunk;
                bytesStdout += Buffer.byteLength(chunk);
                if (!primerChunkRecibido) {
                    primerChunkRecibido = true;
                    logInfo(`Gemini CLI: primer chunk stdout recibido a los ${Date.now() - inicioMs}ms.`);
                }
            });
            child.stderr.on('data', d => {
                const chunk = d.toString();
                errorOut += chunk;
                bytesStderr += Buffer.byteLength(chunk);
            });

            child.on('close', code => {
                if (!resuelta) {
                    resuelta = true;
                    clearTimeout(timer);
                    clearInterval(timerHeartbeat);
                    limpiarTmp();
                    const duracionMs = Date.now() - inicioMs;
                    logInfo(`Gemini CLI finalizado en ${duracionMs}ms (code: ${code}, stdout: ${bytesStdout} bytes, stderr: ${bytesStderr} bytes).`);
                    if (code !== 0) {
                        logError(`Gemini CLI Fallo (code: ${code}). Err: ${errorOut}`);
                        resolve(null);
                    } else {
                        const parts = output.split('Loaded cached credentials.');
                        resolve((parts.length > 1 ? parts.pop()?.trim() : output.trim()) || output);
                    }
                }
            });

            child.on('error', err => {
                if (!resuelta) {
                    resuelta = true;
                    clearTimeout(timer);
                    clearInterval(timerHeartbeat);
                    limpiarTmp();
                    logError('Error spawneando Gemini CLI.', err);
                    resolve(null);
                }
            });

            cancelToken?.onCancellationRequested(() => {
                if (!resuelta) {
                    resuelta = true;
                    clearTimeout(timer);
                    clearInterval(timerHeartbeat);
                    matarProcesoGemini();
                    limpiarTmp();
                    resolve(null);
                }
            });
        } catch (e) {
            clearTimeout(timer);
            clearInterval(timerHeartbeat);
            matarProcesoGemini();
            limpiarTmp();
            logError('Exception en ejecutarConGeminiCli', e);
            resolve(null);
        }
    });
}

/* Ejecuta el request al modelo con timeout y cancelacion limpia.
 * Al expirar el timeout, se cancela el request via CancellationToken
 * para liberar recursos del modelo y evitar streaming huerfano. */
async function ejecutarConTimeout(modelo: vscode.LanguageModelChat, mensajes: vscode.LanguageModelChatMessage[], timeoutMs: number, cancelToken?: vscode.CancellationToken): Promise<string | null> {
    const cts = new vscode.CancellationTokenSource();
    const tokenEfectivo = cancelToken ? combinedToken(cancelToken, cts.token) : cts.token;

    let resuelta = false;

    return new Promise<string | null>(async resolve => {
        const timer = setTimeout(() => {
            if (!resuelta) {
                resuelta = true;
                logWarn(`Timeout en request IA (${timeoutMs}ms). Cancelando request...`);
                cts.cancel();
                resolve(null);
            }
        }, timeoutMs);

        try {
            const response = await modelo.sendRequest(mensajes, {}, tokenEfectivo);

            let textoCompleto = '';
            for await (const fragmento of response.text) {
                if (resuelta) {
                    break;
                }
                textoCompleto += fragmento;
            }

            if (!resuelta) {
                resuelta = true;
                clearTimeout(timer);
                resolve(textoCompleto);
            }
        } catch (error) {
            if (!resuelta) {
                resuelta = true;
                clearTimeout(timer);
                /* Cancelacion por timeout no es un error real, ya se resolvio con null */
                if (cts.token.isCancellationRequested) {
                    resolve(null);
                } else {
                    logError('Error en request IA', error);
                    resolve(null);
                }
            }
        } finally {
            cts.dispose();
        }
    });
}

/* Combina dos CancellationTokens: cancela si cualquiera de los dos se cancela */
function combinedToken(tokenA: vscode.CancellationToken, tokenB: vscode.CancellationToken): vscode.CancellationToken {
    const cts = new vscode.CancellationTokenSource();
    tokenA.onCancellationRequested(() => cts.cancel());
    tokenB.onCancellationRequested(() => cts.cancel());
    return cts.token;
}

/* Parsea la respuesta JSON del modelo, con fallback para formatos inesperados */
function parsearRespuesta(respuesta: string): ViolacionIA[] {
    try {
        /* Intentar extraer JSON si viene envuelto en markdown */
        let json = respuesta.trim();

        /* Remover bloques de codigo markdown si existen */
        const matchCodeBlock = /```(?:json)?\s*([\s\S]*?)```/.exec(json);
        if (matchCodeBlock) {
            json = matchCodeBlock[1].trim();
        }

        const parsed: RespuestaIA = JSON.parse(json);

        if (!parsed.violaciones || !Array.isArray(parsed.violaciones)) {
            return [];
        }

        /* Validar estructura de cada violacion */
        return parsed.violaciones.filter(v => typeof v.linea === 'number' && typeof v.mensaje === 'string' && v.mensaje.length > 0);
    } catch (error) {
        logError('Error parseando respuesta IA', error);
        return [];
    }
}

/*
 * Filtra violaciones IA que duplican o contradicen reglas estaticas.
 * - archivo-monolito: SIEMPRE se descarta de la IA. El analyzer estatico ya
 *   genera 'limite-lineas' con rango puntual. La IA lo reporta con rango
 *   linea1-lineaFin que pinta todo el archivo en rojo.
 * - catch-vacio en PHP: ya cubierto por regex estatico sin falsos positivos.
 */
function filtrarViolacionesInconsistentes(violaciones: ViolacionIA[], totalLineasReales: number): ViolacionIA[] {
    return violaciones.filter(v => {
        const regla = (v.regla || '').toLowerCase().trim();
        /* Siempre descartar: el static lo cubre con rango puntual */
        if (regla === 'archivo-monolito') {
            return false;
        }
        /* Evitar que la IA reporte limite-lineas directamente */
        if (regla === 'limite-lineas') {
            return false;
        }
        return true;
    });
}

/* Invalida el cache del modelo (util si cambia la configuracion) */
export function invalidarCacheModelo(): void {
    modeloCache = null;
}
