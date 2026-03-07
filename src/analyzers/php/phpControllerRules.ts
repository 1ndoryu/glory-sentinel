/*
 * Reglas de controller PHP/WordPress.
 * Detecta metodos publicos de controllers REST sin try-catch global.
 */

import {Violacion} from '../../types';
import {obtenerSeveridadRegla} from '../../config/ruleRegistry';
import {esComentario, tieneSentinelDisable} from '../../utils/analisisHelpers';

/*
 * Detecta metodos publicos de controllers sin try-catch global.
 * Un controller se identifica por: clase con sufijo Endpoints/Controller
 * y metodos publicos que no envuelven su cuerpo en try-catch.
 *
 * Exclusiones:
 * - Metodos de configuracion: registerRoutes, register.
 * - Permission callbacks: can*, verificar*, checkPermission.
 * - Clases con trait ConCallbackSeguro (ya wrappea handlers).
 * - Controllers no-REST (sin register_rest_route/WP_REST_Response).
 */
export function verificarControllerSinTryCatch(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];
    const esController = lineas.some(l => /class\s+\w*(Endpoints|Controller|Controlador)\b/.test(l));

    if (!esController) {
        return [];
    }

    const textoCompleto = lineas.join('\n');
    const esControllerRest = /register_rest_route|WP_REST_Response|WP_REST_Request/.test(textoCompleto);
    if (!esControllerRest) {
        return [];
    }

    const usaTraitSeguro = lineas.some(l => /use\s+ConCallbackSeguro\b/.test(l));
    if (usaTraitSeguro) {
        return [];
    }

    let dentroDeMetodoPublico = false;
    let lineaMetodo = 0;
    let nombreMetodo = '';
    let llaves = 0;
    let tieneTryCatch = false;
    let primeraInstruccion = true;

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i].trim();

        const matchMetodo = /public\s+(?:static\s+)?function\s+(\w+)\s*\(/.exec(linea);
        if (matchMetodo) {
            if (dentroDeMetodoPublico && !tieneTryCatch && nombreMetodo && !esMetodoExcluido(nombreMetodo)) {
                violaciones.push({
                    reglaId: 'controller-sin-trycatch',
                    mensaje: `Metodo publico "${nombreMetodo}" sin try-catch global. Envolver cuerpo completo en try { ... } catch (\\Throwable $e).`,
                    severidad: obtenerSeveridadRegla('controller-sin-trycatch'),
                    linea: lineaMetodo,
                    fuente: 'estatico'
                });
            }

            dentroDeMetodoPublico = true;
            lineaMetodo = i;
            nombreMetodo = matchMetodo[1];
            llaves = 0;
            tieneTryCatch = false;
            primeraInstruccion = true;
            continue;
        }

        if (!dentroDeMetodoPublico) {
            continue;
        }

        for (const char of lineas[i]) {
            if (char === '{') {
                llaves++;
            }
            if (char === '}') {
                llaves--;
            }
        }

        if (linea.startsWith('try') || /\btry\s*\{/.test(linea)) {
            tieneTryCatch = true;
        }

        if (primeraInstruccion && linea !== '' && linea !== '{') {
            primeraInstruccion = false;
        }

        if (llaves <= 0 && !primeraInstruccion) {
            if (!tieneTryCatch && nombreMetodo && !esMetodoExcluido(nombreMetodo)) {
                const lineasEfectivas = contarLineasMetodo(lineas, lineaMetodo, i);
                const esMetodoTrivial = lineasEfectivas < 5;
                const esMetodoPuro = esRetornoConstante(lineas, lineaMetodo, i);
                if (!esMetodoTrivial && !esMetodoPuro) {
                    violaciones.push({
                        reglaId: 'controller-sin-trycatch',
                        mensaje: `Metodo publico "${nombreMetodo}" sin try-catch global. Envolver cuerpo completo en try { ... } catch (\\Throwable $e).`,
                        severidad: obtenerSeveridadRegla('controller-sin-trycatch'),
                        linea: lineaMetodo,
                        fuente: 'estatico'
                    });
                }
            }
            dentroDeMetodoPublico = false;
        }
    }

    return violaciones;
}

/* Nombres de metodos de configuracion/permisos que no necesitan try-catch */
function esMetodoExcluido(nombre: string): boolean {
    if (/^register(Routes)?$/i.test(nombre)) {
        return true;
    }
    if (/^registrar(Rutas)?$/i.test(nombre)) {
        return true;
    }
    if (/^(can[A-Z]|verificar|checkPermission)/i.test(nombre)) {
        return true;
    }
    if (/^(crearTabla|enqueue)/i.test(nombre)) {
        return true;
    }
    return false;
}

/* Cuenta lineas efectivas de un metodo (excluyendo vacias y comentarios) */
function contarLineasMetodo(lineas: string[], inicio: number, fin: number): number {
    let cuenta = 0;
    for (let i = inicio; i <= fin && i < lineas.length; i++) {
        const trimmed = lineas[i].trim();
        if (trimmed !== '' && !esComentario(trimmed)) {
            cuenta++;
        }
    }
    return cuenta;
}

/* Detecta metodos "puros" que solo retornan constantes (sin I/O). */
function esRetornoConstante(lineas: string[], inicio: number, fin: number): boolean {
    let tieneIO = false;
    for (let i = inicio; i <= fin && i < lineas.length; i++) {
        const trimmed = lineas[i].trim();
        if (trimmed === '' || trimmed === '{' || trimmed === '}' || esComentario(trimmed) || /^public\s+/.test(trimmed)) {
            continue;
        }
        if (/\$this\s*->|self::|static::|new\s+\w+(?!.*WP_REST_Response)|\$wpdb|\bquery\b|\bfetch\b|\bexec\b|\bcurl|\bfile_|\bfopen\b/.test(trimmed)) {
            if (!/^\s*return\s+new\s+\\?WP_REST_Response/.test(trimmed)) {
                tieneIO = true;
                break;
            }
        }
    }
    return !tieneIO;
}

/*
 * Detecta advisory lock / flock sin bloque finally para garantizar liberacion.
 * Un lock sin finally produce lock huerfano si el codigo intermedio lanza excepcion.
 */
export function verificarLockSinFinally(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];

    for (let i = 0; i < lineas.length; i++) {
        if (tieneSentinelDisable(lineas, i, 'lock-sin-finally')) { continue; }

        /* Solo detectar LLAMADAS (::advisoryLock( o ->advisoryLock(), o flock()).
         * Excluir: definiciones de funcion, comentarios, SQL dentro de wrappers. */
        if (!/(->|::)advisory[Ll]ock\s*\(|\bflock\s*\(/.test(lineas[i])) {
            continue;
        }

        /* Buscar finally con unlock en las siguientes 150 lineas (scope del metodo) */
        const ventana = lineas.slice(i, Math.min(lineas.length, i + 150)).join('\n');
        const tieneFinally = /finally\s*\{[^}]*(?:advisory[Uu]nlock|pg_advisory_unlock|fclose|flock)/s.test(ventana);

        if (!tieneFinally) {
            violaciones.push({
                reglaId: 'lock-sin-finally',
                mensaje: 'Advisory lock / flock sin bloque finally para liberacion. Riesgo de lock huerfano si hay excepcion.',
                severidad: obtenerSeveridadRegla('lock-sin-finally'),
                linea: i,
                fuente: 'estatico',
            });
        }
    }

    return violaciones;
}

/*
 * Detecta catch en metodos criticos (revenue/pago/transaccion) que solo logea sin re-throw.
 * Un fallo silencioso en operaciones financieras causa perdida de datos sin alerta.
 */
export function verificarCatchCriticoSoloLog(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];
    const patronMetodoCritico = /function\s+\w*(revenue|pago|transaccion|cobro|factur|monetiz|comision|ingreso)/i;

    let dentroDeMetodoCritico = false;
    let profundidadMetodo = 0;
    let lineaMetodo = 0;

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i].trim();

        if (patronMetodoCritico.test(linea)) {
            dentroDeMetodoCritico = true;
            profundidadMetodo = 0;
            lineaMetodo = i;
        }

        if (dentroDeMetodoCritico) {
            for (const c of lineas[i]) {
                if (c === '{') { profundidadMetodo++; }
                if (c === '}') { profundidadMetodo--; }
            }

            if (profundidadMetodo <= 0 && i > lineaMetodo) {
                dentroDeMetodoCritico = false;
                continue;
            }

            /* Detectar catch dentro del metodo critico */
            if (/\bcatch\s*\(/.test(linea)) {
                if (tieneSentinelDisable(lineas, i, 'catch-critico-solo-log')) { continue; }

                /* Examinar cuerpo del catch (hasta cierre de llave) */
                let cuerpoCatch = '';
                let llavesCatch = 0;
                for (let j = i; j < Math.min(lineas.length, i + 30); j++) {
                    cuerpoCatch += lineas[j] + '\n';
                    for (const c of lineas[j]) {
                        if (c === '{') { llavesCatch++; }
                        if (c === '}') { llavesCatch--; }
                    }
                    if (llavesCatch <= 0 && j > i) { break; }
                }

                const soloLogea = /\b(log|Logger|error_log|logError|logWarn)\b/i.test(cuerpoCatch);
                const reThrow = /\bthrow\b/.test(cuerpoCatch);
                const returnError = /\breturn\s+(false|null|\$|new\s+\\?WP_Error|new\s+\\?WP_REST_Response\(.*[45]\d{2})/i.test(cuerpoCatch);

                if (soloLogea && !reThrow && !returnError) {
                    violaciones.push({
                        reglaId: 'catch-critico-solo-log',
                        mensaje: 'Catch en metodo critico (financiero) solo logea sin re-throw ni return de error. Fallo silencioso en operacion financiera.',
                        severidad: obtenerSeveridadRegla('catch-critico-solo-log'),
                        linea: i,
                        fuente: 'estatico',
                        sugerencia: 'Re-lanzar excepcion o retornar false/WP_Error para que el caller pueda reaccionar.',
                    });
                }
            }
        }
    }

    return violaciones;
}
