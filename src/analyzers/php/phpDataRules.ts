/*
 * Reglas de acceso a datos PHP/WordPress.
 * Detecta: $wpdb sin prepare y retorno ignorado de repositorio.
 * Las reglas de flujo de datos (request JSON, json_decode, consistencia, json sin limite) estan en phpDataFlujoRules.ts.
 */

import {Violacion} from '../../types';
import {obtenerSeveridadRegla} from '../../config/ruleRegistry';
import {tieneSentinelDisable, esRutaGlory} from '../../utils/analisisHelpers';
import { AjustesProyecto, AJUSTES_PROYECTO_DEFECTO } from '../ajustesProyecto';

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
 * Detecta llamadas a metodos de Repository/Service cuyo nombre sugiere escritura
 * donde el valor de retorno no se captura ni se usa en condicion.
 */
export function verificarRetornoIgnoradoRepo(lineas: string[], rutaArchivo?: string, ajustes: AjustesProyecto = AJUSTES_PROYECTO_DEFECTO): Violacion[] {
    const violaciones: Violacion[] = [];
    /* El framework Glory usa metodos void de orquestacion — excluir para evitar falsos positivos */
    if (rutaArchivo && esRutaGlory(rutaArchivo, ajustes.marcadoresGlory)) { return violaciones; }
    const patronEscritura = /->\s*(registrar|guardar|insertar|actualizar|crear|grabar|save|update|insert|delete|eliminar|borrar)\w*\s*\(/;

    for (let i = 0; i < lineas.length; i++) {
        if (tieneSentinelDisable(lineas, i, 'retorno-ignorado-repo')) { continue; }

        const linea = lineas[i].trim();
        if (!patronEscritura.test(linea)) { continue; }

        /* Excluir si el retorno se captura ($var = ...) o se usa en condicion (if (...)) */
        if (/^\$\w+\s*=/.test(linea)) { continue; }
        if (/^if\s*\(/.test(linea)) { continue; }
        if (/^return\b/.test(linea)) { continue; }
        if (/^!?\$\w+\s*&&/.test(linea)) { continue; }

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
