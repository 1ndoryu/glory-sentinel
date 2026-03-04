/*
 * Reglas de acceso a datos PHP/WordPress.
 * Detecta: $wpdb sin prepare, request JSON directo, json_decode inseguro.
 */

import {Violacion} from '../../types';
import {obtenerSeveridadRegla} from '../../config/ruleRegistry';

/*
 * Verifica $wpdb sin prepare con contexto.
 * Excluye: prepare() anidado, queries sin params de usuario,
 * sentencias de transaccion/DDL, variables con prepare cercano.
 */
export function verificarWpdbSinPrepareContextual(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];

        const matchWpdb = /\$wpdb\s*->\s*(query|get_var|get_results|get_row|get_col)\s*\(/.exec(linea);
        if (!matchWpdb) {
            continue;
        }

        /* Excluir transacciones y DDL */
        const argumento = linea.slice(linea.indexOf(matchWpdb[0]) + matchWpdb[0].length).trim();
        if (/^['"](START\s+TRANSACTION|ROLLBACK|COMMIT|SAVEPOINT|RELEASE\s+SAVEPOINT)/i.test(argumento)) {
            continue;
        }
        if (/^["']?\s*(ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE|CREATE\s+INDEX|DROP\s+INDEX)/i.test(argumento)) {
            continue;
        }
        if (/^\s*"(ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE)/i.test(argumento)) {
            continue;
        }

        /* prepare() en la misma linea (incluyendo anidado) */
        if (/\$wpdb\s*->\s*prepare\s*\(/.test(linea)) {
            continue;
        }

        /* prepare() en lineas siguientes (argumento multi-linea) */
        let prepareEnLineaSiguiente = false;
        for (let k = i + 1; k <= Math.min(lineas.length - 1, i + 3); k++) {
            if (/\$wpdb\s*->\s*prepare\s*\(/.test(lineas[k])) {
                prepareEnLineaSiguiente = true;
                break;
            }
        }
        if (prepareEnLineaSiguiente) {
            continue;
        }

        /* Queries sin parametros de usuario no necesitan prepare */
        const lineaCompleta = obtenerSentenciaMultilinea(lineas, i);
        if (esSentenciaSinParametrosUsuario(lineaCompleta)) {
            continue;
        }

        /* Si el argumento es variable, ampliar ventana de busqueda a 50 lineas */
        const matchVarArg = /^\$(\w+)/.exec(argumento);
        const ventanaLineas = matchVarArg ? 50 : 3;

        let tienePrepareCercano = false;
        for (let j = Math.max(0, i - ventanaLineas); j < i; j++) {
            if (/\$wpdb\s*->\s*prepare\s*\(/.test(lineas[j])) {
                tienePrepareCercano = true;
                break;
            }
        }

        if (!tienePrepareCercano) {
            violaciones.push({
                reglaId: 'wpdb-sin-prepare',
                mensaje: `$wpdb->${matchWpdb[1]}() sin $wpdb->prepare(). Usar prepare() obligatoriamente.`,
                severidad: obtenerSeveridadRegla('wpdb-sin-prepare'),
                linea: i,
                fuente: 'estatico'
            });
        }
    }

    return violaciones;
}

/* Reconstruye una sentencia SQL multi-linea (hasta ';' o 10 lineas) */
function obtenerSentenciaMultilinea(lineas: string[], inicio: number): string {
    let resultado = '';
    for (let i = inicio; i < Math.min(lineas.length, inicio + 10); i++) {
        resultado += ' ' + lineas[i];
        if (lineas[i].includes(';')) {
            break;
        }
    }
    return resultado;
}

/* Query sin WHERE/JOIN/HAVING/SET y sin placeholders = segura sin prepare */
function esSentenciaSinParametrosUsuario(sentencia: string): boolean {
    if (/%[dsf]/.test(sentencia)) {
        return false;
    }
    const tieneClausulaConInput = /\b(WHERE|JOIN|HAVING|SET|VALUES|IN\s*\()\b/i.test(sentencia);
    return !tieneClausulaConInput;
}

/*
 * Verifica $request->get_json_params() pasado directamente a capas de datos.
 * Solo reporta si la variable se usa como argumento bare (sin subscript).
 */
export function verificarRequestJsonDirecto(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];

        const matchAsignacion = /(\$\w+)\s*=\s*\$request\s*->\s*get_json_params\s*\(\s*\)/.exec(linea);
        if (!matchAsignacion) {
            continue;
        }

        const varNombre = matchAsignacion[1];
        const varEscapada = varNombre.replace('$', '\\$');

        let lineaUso = -1;
        const fin = Math.min(lineas.length, i + 30);

        for (let j = i + 1; j < fin; j++) {
            const lineaJ = lineas[j];

            const patronBare = new RegExp(`${varEscapada}\\s*[,\\)]`);
            if (!patronBare.test(lineaJ)) {
                continue;
            }

            const lineaSinSubscript = lineaJ.replace(new RegExp(`${varEscapada}\\s*\\[[^\\]]*\\]`, 'g'), '__subscript__');

            const esFuncionFiltrado = /\b(array_intersect_key|array_filter|array_map|array_keys|array_values|array_diff_key|compact)\s*\(/.test(lineaJ);
            if (esFuncionFiltrado) {
                continue;
            }

            if (patronBare.test(lineaSinSubscript)) {
                lineaUso = j;
                break;
            }
        }

        if (lineaUso !== -1) {
            violaciones.push({
                reglaId: 'request-json-directo',
                mensaje: `${varNombre} de get_json_params() pasado directo como argumento. Filtrar campos esperados antes de pasar a la capa de datos.`,
                severidad: obtenerSeveridadRegla('request-json-directo'),
                linea: lineaUso,
                fuente: 'estatico'
            });
        }
    }

    return violaciones;
}

/*
 * Detecta json_decode() sin verificacion de errores.
 * Reconoce validaciones: json_last_error, is_array, null coalescing,
 * ternario pre-validador, guards is_string/isset, null checks post-decode.
 */
export function verificarJsonDecodeInseguro(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];

    for (let i = 0; i < lineas.length; i++) {
        if (!/json_decode\s*\(/.test(lineas[i])) {
            continue;
        }

        const lineaActual = lineas[i];

        /* Proteccion inline */
        if (/json_decode\s*\([^)]*\)\s*\?\?/.test(lineaActual)) {
            continue;
        }
        if (/\?\s*\\?json_decode/.test(lineaActual)) {
            continue;
        }

        /* Proteccion en lineas cercanas */
        let tieneVerificacion = false;

        for (let j = Math.max(0, i - 5); j < i; j++) {
            if (/\b(is_string|isset|!empty)\s*\(/.test(lineas[j])) {
                tieneVerificacion = true;
                break;
            }
        }

        if (!tieneVerificacion) {
            for (let j = i; j < Math.min(lineas.length, i + 7); j++) {
                if (/json_last_error|json_last_error_msg|is_array|is_object/.test(lineas[j])) {
                    tieneVerificacion = true;
                    break;
                }
                if (j > i && /if\s*\(\s*(!|\bnull\b|empty\s*\()/.test(lineas[j])) {
                    tieneVerificacion = true;
                    break;
                }
                if (j > i && /\$\w+\s*===?\s*null/.test(lineas[j])) {
                    tieneVerificacion = true;
                    break;
                }
                if (j > i && /\?\?/.test(lineas[j])) {
                    tieneVerificacion = true;
                    break;
                }
            }
        }

        if (!tieneVerificacion) {
            violaciones.push({
                reglaId: 'json-decode-inseguro',
                mensaje: 'json_decode() sin verificar json_last_error(). Datos corruptos se propagan como null silencioso.',
                severidad: obtenerSeveridadRegla('json-decode-inseguro'),
                linea: i,
                fuente: 'estatico'
            });
        }
    }

    return violaciones;
}
