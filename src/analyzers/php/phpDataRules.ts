/*
 * Reglas de acceso a datos PHP/WordPress.
 * Detecta: $wpdb sin prepare, request JSON directo, json_decode inseguro,
 * TOCTOU select-insert, cadenas isset-update, queries dobles, json sin limite, retorno ignorado.
 */

import {Violacion} from '../../types';
import {obtenerSeveridadRegla} from '../../config/ruleRegistry';
import {tieneSentinelDisable, esRutaGlory} from '../../utils/analisisHelpers';

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

/*
 * Detecta llamadas a metodos de Repository/Service cuyo nombre sugiere escritura
 * donde el valor de retorno no se captura ni se usa en condicion.
 */
export function verificarRetornoIgnoradoRepo(lineas: string[], rutaArchivo?: string): Violacion[] {
    const violaciones: Violacion[] = [];
    /* El framework Glory usa metodos void de orquestacion — excluir para evitar falsos positivos */
    if (rutaArchivo && esRutaGlory(rutaArchivo)) { return violaciones; }
    const patronEscritura = /->\s*(registrar|guardar|insertar|actualizar|crear|grabar|save|update|insert|delete|eliminar|borrar)\w*\s*\(/;

    for (let i = 0; i < lineas.length; i++) {
        if (tieneSentinelDisable(lineas, i, 'retorno-ignorado-repo')) { continue; }

        const linea = lineas[i].trim();
        if (!patronEscritura.test(linea)) { continue; }

        /* Excluir si el retorno se captura ($var = ...) o se usa en condicion (if (...)) */
        if (/^\$\w+\s*=/.test(linea)) { continue; }
        if (/^if\s*\(/.test(linea)) { continue; }
        if (/^return\b/.test(linea)) { continue; }
        if (/^\!?\$\w+\s*&&/.test(linea)) { continue; }

        /* Excluir si esta dentro de un if() en la misma linea */
        if (/\bif\s*\(.*->/.test(linea)) { continue; }

        /* Excluir asignacion compuesta */
        if (/\$\w+\[.*\]\s*=/.test(linea)) { continue; }

        /* Excluir metodos de log/event que no requieren check */
        if (/->\s*(log|emit|dispatch|fire|notify|registrarEvento|registrarLog)\w*\s*\(/i.test(linea)) { continue; }

        violaciones.push({
            reglaId: 'retorno-ignorado-repo',
            mensaje: 'Retorno de metodo de escritura (Repository/Service) no capturado. El caller no puede verificar exito/fallo.',
            severidad: obtenerSeveridadRegla('retorno-ignorado-repo'),
            linea: i,
            fuente: 'estatico',
            sugerencia: 'Capturar el retorno: $resultado = ... y verificar antes de continuar.',
        });
    }

    return violaciones;
}
