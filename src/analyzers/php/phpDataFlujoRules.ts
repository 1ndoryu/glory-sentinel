/*
 * Reglas de flujo de datos PHP/WordPress: request JSON directo, json_decode
 * inseguro, TOCTOU select-insert, cadenas isset-update, queries dobles y json
 * sin limite en BD.
 */

import {Violacion} from '../../types';
import {obtenerSeveridadRegla} from '../../config/ruleRegistry';
import {tieneSentinelDisable} from '../../utils/analisisHelpers';

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

            const esFuncionFiltrado = /\b(array_intersect_key|array_filter|array_map|array_keys|array_values|array_diff_key|compact|empty|isset|count|is_array|is_null)\s*\(/.test(lineaJ);
            if (esFuncionFiltrado) {
                continue;
            }

            if (patronBare.test(lineaSinSubscript)) {
                lineaUso = j;
                break;
            }
        }

        if (lineaUso !== -1) {
            /* Respetar sentinel-disable-next-line request-json-directo en la línea anterior al uso */
            if (lineas[lineaUso - 1]?.includes('sentinel-disable-next-line request-json-directo')) {
                continue;
            }
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
        if (tieneSentinelDisable(lineas, i, 'json-decode-inseguro')) { continue; }

        const lineaActual = lineas[i];

        /* Detectar fallback silencioso: ?: [] o ?? [] enmascara null sin json_last_error */
        const tieneFallbackSilencioso = /json_decode\s*\([^)]*\)\s*(\?\?|\?:)\s*(\[\]|array\s*\(\s*\)|null|false|''\s*|""\s*)/.test(lineaActual);

        /* Proteccion en lineas cercanas: solo guards autenticos */
        let tieneVerificacion = false;

        for (let j = Math.max(0, i - 5); j < i; j++) {
            if (/\b(is_string|isset|!empty)\s*\(/.test(lineas[j])) {
                tieneVerificacion = true;
                break;
            }
        }

        if (!tieneVerificacion) {
            for (let j = i; j < Math.min(lineas.length, i + 7); j++) {
                if (/json_last_error|json_last_error_msg/.test(lineas[j])) {
                    tieneVerificacion = true;
                    break;
                }
                /* is_array/is_object despues de json_decode es guard valido */
                if (j > i && /\b(is_array|is_object)\s*\(/.test(lineas[j])) {
                    tieneVerificacion = true;
                    break;
                }
                if (j > i && /\$\w+\s*===?\s*null/.test(lineas[j])) {
                    tieneVerificacion = true;
                    break;
                }
            }
        }

        if (tieneFallbackSilencioso && !tieneVerificacion) {
            violaciones.push({
                reglaId: 'json-decode-inseguro',
                mensaje: 'json_decode() con fallback (?? o ?:) enmascara error sin json_last_error(). Datos corruptos se pierden silenciosamente.',
                severidad: obtenerSeveridadRegla('json-decode-inseguro'),
                linea: i,
                fuente: 'estatico',
                sugerencia: 'Verificar json_last_error() !== JSON_ERROR_NONE despues de json_decode() antes de aplicar fallback.',
            });
        } else if (!tieneVerificacion && !tieneFallbackSilencioso) {
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

/*
 * Detecta TOCTOU: SELECT MAX/COUNT seguido de INSERT en el mismo metodo, misma tabla.
 * Sin transaccion atomica, dos requests concurrentes pueden obtener el mismo valor.
 */
export function verificarToctouSelectInsert(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];
    const patronSelectCount = /\b(SELECT\s+(?:MAX|COUNT|COALESCE)\s*\([^)]*\)\s+FROM\s+['"]?(\w+)['"]?)/i;
    const dentroDeTransaccion = /\b(BEGIN|START\s+TRANSACTION)\b/i;

    for (let i = 0; i < lineas.length; i++) {
        if (tieneSentinelDisable(lineas, i, 'toctou-select-insert')) { continue; }

        const matchSelect = patronSelectCount.exec(lineas[i]);
        if (!matchSelect) { continue; }

        const tabla = matchSelect[2].toLowerCase();

        /* Verificar si hay un BEGIN/TRANSACTION en las 10 lineas previas */
        let enTransaccion = false;
        for (let j = Math.max(0, i - 10); j < i; j++) {
            if (dentroDeTransaccion.test(lineas[j])) {
                enTransaccion = true;
                break;
            }
        }
        if (enTransaccion) { continue; }

        /* Buscar INSERT en la misma tabla en las siguientes 20 lineas */
        for (let j = i + 1; j < Math.min(lineas.length, i + 20); j++) {
            const patronInsert = new RegExp(`\\bINSERT\\s+INTO\\s+['"]?${tabla}['"]?`, 'i');
            if (patronInsert.test(lineas[j])) {
                violaciones.push({
                    reglaId: 'toctou-select-insert',
                    mensaje: `TOCTOU: SELECT seguido de INSERT en '${tabla}' sin transaccion. Vulnerable a race condition.`,
                    severidad: obtenerSeveridadRegla('toctou-select-insert'),
                    linea: i,
                    fuente: 'estatico',
                    sugerencia: 'Usar INSERT ... ON CONFLICT, transaccion atomica o advisory lock.',
                });
                break;
            }
        }
    }

    return violaciones;
}

/*
 * Detecta cadenas de 5+ bloques if(isset($body[... consecutivos.
 * Senal de strategy pattern / update handler faltante (violacion OCP).
 */
export function verificarCadenaIssetUpdate(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];
    const UMBRAL = 5;
    const patronIsset = /if\s*\(\s*isset\s*\(\s*\$(?:body|datos|data|params|request)\s*\[/;

    let contadorConsecutivo = 0;
    let lineaInicio = 0;

    for (let i = 0; i < lineas.length; i++) {
        if (patronIsset.test(lineas[i])) {
            if (contadorConsecutivo === 0) { lineaInicio = i; }
            contadorConsecutivo++;
        } else if (lineas[i].trim() !== '' && !/^\s*[{}]\s*$/.test(lineas[i]) && !/^\s*\/\//.test(lineas[i])) {
            if (contadorConsecutivo >= UMBRAL) {
                if (!tieneSentinelDisable(lineas, lineaInicio, 'cadena-isset-update')) {
                    violaciones.push({
                        reglaId: 'cadena-isset-update',
                        mensaje: `${contadorConsecutivo} bloques if(isset($body[...])) consecutivos. Considerar strategy pattern o update handler.`,
                        severidad: obtenerSeveridadRegla('cadena-isset-update'),
                        linea: lineaInicio,
                        fuente: 'estatico',
                        sugerencia: 'Extraer la logica de cada campo a un handler dedicado (array de strategies).',
                    });
                }
            }
            contadorConsecutivo = 0;
        }
    }

    /* Revisar al final del archivo */
    if (contadorConsecutivo >= UMBRAL && !tieneSentinelDisable(lineas, lineaInicio, 'cadena-isset-update')) {
        violaciones.push({
            reglaId: 'cadena-isset-update',
            mensaje: `${contadorConsecutivo} bloques if(isset($body[...])) consecutivos. Considerar strategy pattern o update handler.`,
            severidad: obtenerSeveridadRegla('cadena-isset-update'),
            linea: lineaInicio,
            fuente: 'estatico',
        });
    }

    return violaciones;
}

/*
 * Detecta query de verificacion (COUNT/SELECT WHERE id) seguida de query de datos
 * sobre la misma tabla en <20 lineas. Roundtrip innecesario.
 */
export function verificarQueryDobleVerificacion(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];
    const patronVerificacion = /\b(?:SELECT\s+(?:COUNT|1|id)\s*.*FROM|->(?:count|exists)\s*\().*?['"]?(\w+)['"]?/i;

    for (let i = 0; i < lineas.length; i++) {
        if (tieneSentinelDisable(lineas, i, 'query-doble-verificacion')) { continue; }

        const matchVerif = patronVerificacion.exec(lineas[i]);
        if (!matchVerif) { continue; }

        const tabla = matchVerif[1]?.toLowerCase();
        if (!tabla || tabla.length < 3) { continue; }

        /* Ignorar palabras que son sufijos de clases PHP (LikesCols -> 'likescols')
         * o el nombre de la variable PHP $tabla, no un alias SQL real. */
        const ALIAS_EXCLUIDOS = new Set(['tabla', 'col', 'cols', 'id', 'tipo']);
        if (ALIAS_EXCLUIDOS.has(tabla) || /(?:cols|enums|dto|schema)$/.test(tabla)) { continue; }

        /* Si el nombre capturado viene de interpolacion PHP ({$alias}) es un alias de variable, no tabla real */
        if (lineas[i].includes(`{$${tabla}}`) || new RegExp(`\\$${tabla}\\b`).test(lineas[i])) { continue; }

        /* Buscar query de datos sobre misma tabla en las siguientes 20 lineas */
        for (let j = i + 1; j < Math.min(lineas.length, i + 20); j++) {
            const lineaJ = lineas[j].toLowerCase();
            if (lineaJ.includes(tabla) && /\b(select|get_results|get_row|find|obtener|buscar)\b/i.test(lineas[j])) {
                /* Excluir si la segunda query es claramente diferente (INSERT/UPDATE/DELETE) */
                if (/\b(INSERT|UPDATE|DELETE)\b/i.test(lineas[j])) { continue; }

                violaciones.push({
                    reglaId: 'query-doble-verificacion',
                    mensaje: `Query de verificacion seguida de query de datos sobre '${tabla}'. Combinar en una sola query.`,
                    severidad: obtenerSeveridadRegla('query-doble-verificacion'),
                    linea: i,
                    fuente: 'estatico',
                    sugerencia: 'Usar la query de datos directamente y verificar si retorna resultados.',
                });
                break;
            }
        }
    }

    return violaciones;
}

/*
 * Detecta json_encode pasado a INSERT/UPDATE sin verificacion de tamano.
 * Metadata JSON sin limite puede causar overflow en columnas de BD.
 */
export function verificarJsonSinLimiteBd(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];

    for (let i = 0; i < lineas.length; i++) {
        if (tieneSentinelDisable(lineas, i, 'json-sin-limite-bd')) { continue; }
        if (!/json_encode\s*\(/.test(lineas[i])) { continue; }

        /* Verificar si el resultado se pasa a query/repository en las siguientes 15 lineas */
        let seUsaEnBd = false;
        for (let j = i; j < Math.min(lineas.length, i + 15); j++) {
            if (/\b(INSERT|UPDATE|->(?:insert|update|guardar|registrar|crear|save))\b/i.test(lineas[j])) {
                seUsaEnBd = true;
                break;
            }
        }
        if (!seUsaEnBd) { continue; }

        /* Verificar si hay strlen/mb_strlen check previo */
        let tieneVerificacionTamano = false;
        for (let j = Math.max(0, i - 5); j <= i; j++) {
            if (/\b(strlen|mb_strlen)\s*\(/.test(lineas[j])) {
                tieneVerificacionTamano = true;
                break;
            }
        }

        if (!tieneVerificacionTamano) {
            violaciones.push({
                reglaId: 'json-sin-limite-bd',
                mensaje: 'json_encode() hacia BD sin verificacion de tamano. Riesgo de overflow en columna.',
                severidad: obtenerSeveridadRegla('json-sin-limite-bd'),
                linea: i,
                fuente: 'estatico',
                sugerencia: 'Verificar strlen() del JSON antes de insertar/actualizar en BD.',
            });
        }
    }

    return violaciones;
}
