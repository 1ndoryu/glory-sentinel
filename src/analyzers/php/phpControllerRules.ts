/*
 * Reglas de controller PHP/WordPress.
 * Detecta metodos publicos de controllers REST sin try-catch global.
 */

import {Violacion} from '../../types';
import {obtenerSeveridadRegla} from '../../config/ruleRegistry';
import {esComentario} from '../../utils/analisisHelpers';

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
