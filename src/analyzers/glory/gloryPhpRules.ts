/*
 * Reglas PHP especificas del framework Glory.
 * Detecta violaciones del Schema System (hardcoded SQL columns/enums),
 * patrones inseguros (INTERVAL, open redirect), calidad de codigo
 * (return void, FQN inline, N+1, SELECT *, phpSinReturnType).
 *
 * Extraido de gloryAnalyzer.ts para cumplir SRP (~500 lineas).
 */

import * as path from 'path';
import {Violacion} from '../../types';
import {obtenerSeveridadRegla} from '../../config/ruleRegistry';
import {esComentario, tieneSentinelDisable} from '../../utils/analisisHelpers';
import {obtenerMapaCols, obtenerMapaEnums, type MapaCols, type EntradaEnum} from './schemaLoader';

/* Valores de columna demasiado genericos para reportar (falsos positivos) */
const COLUMNAS_IGNORADAS = new Set(['id', 'tipo', 'estado', 'created_at', 'updated_at', 'nombre']);

/* Valores enum demasiado comunes para reportar (falsos positivos masivos) */
const VALORES_IGNORADOS_ENUM = new Set(['true', 'false', 'null', 'ok', 'error', 'id', 'key', 'type', 'name', 'value', 'data', 'status', 'message', 'result', 'success', 'fail', 'yes', 'no', 'on', 'off', '0', '1']);

/* ====================================================================
 * HARDCODED SQL COLUMN
 * Detecta strings literales de nombres de columna en contexto SQL
 * que deberian usar constantes Cols.
 * ==================================================================== */

export function verificarHardcodedSqlColumn(lineas: string[], rutaArchivo: string): Violacion[] {
    const violaciones: Violacion[] = [];
    const mapaCols = obtenerMapaCols();
    if (!mapaCols) {
        return violaciones;
    }

    /* Excluir archivos generados, migrations y el framework Glory */
    if (rutaArchivo.includes('_generated/') || rutaArchivo.includes('/migrations/') || rutaArchivo.includes('/seeders/') || rutaArchivo.includes('/Glory/')) {
        return violaciones;
    }

    /* Contextos SQL: SELECT, WHERE, ORDER BY, GROUP BY, INSERT INTO, UPDATE SET, JOIN ON */
    const regexContextoSql = /\b(SELECT|WHERE|ORDER\s+BY|GROUP\s+BY|INSERT\s+INTO|UPDATE\s+.*SET|JOIN\s+.*ON|HAVING)\b/i;

    /* Construir set de todas las columnas conocidas con su info */
    const todasColumnas = new Map<string, {tabla: string; clase: string; constante: string}>();
    for (const [tabla, info] of Object.entries(mapaCols)) {
        for (const [valorColumna, nombreConstante] of info.columnas) {
            if (!COLUMNAS_IGNORADAS.has(valorColumna)) {
                todasColumnas.set(valorColumna, {tabla, clase: info.clase, constante: nombreConstante});
            }
        }
    }

    for (let i = 0; i < lineas.length; i++) {
        if (esComentario(lineas[i])) {
            continue;
        }
        if (tieneSentinelDisable(lineas, i, 'hardcoded-sql-column')) {
            continue;
        }

        const linea = lineas[i];

        /* Verificar si la linea o vecinas tienen contexto SQL */
        const ventana = 3;
        let tieneContextoSql = false;
        for (let j = Math.max(0, i - ventana); j <= Math.min(lineas.length - 1, i + ventana); j++) {
            if (regexContextoSql.test(lineas[j])) {
                tieneContextoSql = true;
                break;
            }
        }
        if (!tieneContextoSql) {
            continue;
        }

        /* Buscar strings literales en la linea */
        const regexString = /['"]([a-z_]{2,50})['"]/g;
        let match: RegExpExecArray | null;
        while ((match = regexString.exec(linea)) !== null) {
            const valor = match[1];
            const info = todasColumnas.get(valor);
            if (info) {
                /* Excluir si ya usa constante en la misma linea */
                if (new RegExp(`${info.clase}\\s*::\\s*${info.constante}`).test(linea)) {
                    continue;
                }

                violaciones.push({
                    reglaId: 'hardcoded-sql-column',
                    mensaje: `Columna '${valor}' hardcodeada. Usar ${info.clase}::${info.constante} (tabla: ${info.tabla}).`,
                    severidad: obtenerSeveridadRegla('hardcoded-sql-column'),
                    linea: i,
                    columna: match.index,
                    columnaFin: match.index + match[0].length,
                    sugerencia: `Reemplazar '${valor}' con ${info.clase}::${info.constante}`,
                    fuente: 'estatico'
                });
            }
        }
    }

    return violaciones;
}

/* ====================================================================
 * HARDCODED ENUM VALUE
 * Detecta valores de enum hardcodeados (en comparaciones, asignaciones,
 * CASE, SQL) que deberian usar constantes Enums.
 * ==================================================================== */

export function verificarHardcodedEnumValue(lineas: string[], rutaArchivo: string): Violacion[] {
    const violaciones: Violacion[] = [];
    const mapaEnums = obtenerMapaEnums();
    if (!mapaEnums) {
        return violaciones;
    }

    /* Excluir archivos generados, migrations, tests y el framework Glory */
    if (rutaArchivo.includes('_generated/') || rutaArchivo.includes('/migrations/') || rutaArchivo.includes('/seeders/') || rutaArchivo.includes('/tests/') || rutaArchivo.includes('/Glory/')) {
        return violaciones;
    }

    /* Contextos donde aparecen valores de enum */
    const regexComparacion = /(?:===?|!==?)\s*['"]([a-z_]+)['"]/gi;
    const regexAsignacion = /=\s*['"]([a-z_]+)['"]\s*;/gi;
    const regexCase = /case\s+['"]([a-z_]+)['"]\s*:/gi;
    const regexSqlValor = /=\s*['"]([a-z_]+)['"]/gi;

    for (let i = 0; i < lineas.length; i++) {
        if (esComentario(lineas[i])) {
            continue;
        }
        if (tieneSentinelDisable(lineas, i, 'hardcoded-enum-value')) {
            continue;
        }

        const linea = lineas[i];
        /* Excluir lineas de log/error */
        const esLineaLog = /\b(error_log|logInfo|logWarn|logError|console\.(?:log|warn|error)|Log::)\b/.test(linea);

        const buscarEnRegex = (regex: RegExp) => {
            regex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(linea)) !== null) {
                const valor = match[1];
                if (VALORES_IGNORADOS_ENUM.has(valor.toLowerCase())) {
                    continue;
                }
                if (esLineaLog) {
                    continue;
                }

                const entradas = mapaEnums.get(valor);
                if (entradas && entradas.length > 0) {
                    const entrada = entradas[0];
                    const sugerenciaMultiple =
                        entradas.length > 1
                            ? ` (tambien en: ${entradas
                                  .slice(1)
                                  .map(e => e.clase)
                                  .join(', ')})`
                            : '';

                    violaciones.push({
                        reglaId: 'hardcoded-enum-value',
                        mensaje: `'${valor}' deberia usar ${entrada.clase}::${entrada.constante}${sugerenciaMultiple}`,
                        severidad: obtenerSeveridadRegla('hardcoded-enum-value'),
                        linea: i,
                        columna: match.index,
                        columnaFin: match.index + match[0].length,
                        sugerencia: `Reemplazar '${valor}' con ${entrada.clase}::${entrada.constante}`,
                        fuente: 'estatico'
                    });
                }
            }
        };

        buscarEnRegex(regexComparacion);
        buscarEnRegex(regexAsignacion);
        buscarEnRegex(regexCase);
        buscarEnRegex(regexSqlValor);
    }

    return violaciones;
}

/* ====================================================================
 * ENDPOINT ACCEDE BD
 * Detecta queries directas en controllers/endpoints.
 * ==================================================================== */

export function verificarEndpointAccedeBd(lineas: string[], rutaArchivo: string): Violacion[] {
    const violaciones: Violacion[] = [];

    const nombreArchivo = path.basename(rutaArchivo);
    if (!/Controller|Endpoints/i.test(nombreArchivo)) {
        return violaciones;
    }

    if (rutaArchivo.includes('/Glory/') || rutaArchivo.includes('/Repositories/') || rutaArchivo.includes('/Database/') || rutaArchivo.includes('BaseRepository')) {
        return violaciones;
    }

    const textoCompleto = lineas.join('\n');
    const esControllerRest = /register_rest_route|WP_REST_Response|WP_REST_Request/.test(textoCompleto);
    if (!esControllerRest) {
        return violaciones;
    }

    const regexAccesoBd = /(\$this->pg|\$wpdb->(?:query|get_results|get_var|get_row|insert|update|delete|prepare)\s*\(|PostgresService|->ejecutar\()/;

    for (let i = 0; i < lineas.length; i++) {
        if (esComentario(lineas[i])) {
            continue;
        }
        if (tieneSentinelDisable(lineas, i, 'endpoint-accede-bd')) {
            continue;
        }
        if (lineas[i].includes('sentinel-disable endpoint-accede-bd')) {
            continue;
        }
        if (/\b(START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(lineas[i])) {
            continue;
        }

        const match = regexAccesoBd.exec(lineas[i]);
        if (match) {
            violaciones.push({
                reglaId: 'endpoint-accede-bd',
                mensaje: `Query directa en controller/endpoint ('${match[1]}'). Mover logica de datos a un Repository o Service.`,
                severidad: obtenerSeveridadRegla('endpoint-accede-bd'),
                linea: i,
                columna: match.index,
                columnaFin: match.index + match[1].length,
                sugerencia: 'Extraer la query a un metodo en el Repository correspondiente.',
                fuente: 'estatico'
            });
        }
    }

    return violaciones;
}

/* ====================================================================
 * INTERVAL SIN WHITELIST
 * Detecta INTERVAL con variable interpolada sin whitelist.
 * ==================================================================== */

export function verificarIntervalSinWhitelist(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];

    const regexInterval = /INTERVAL\s+['"]?\s*[\$\{]/i;
    const regexInterval2 = /INTERVAL\s+'\s*\$/i;
    const regexWhitelist = /\b(in_array|match\s*\(|switch\s*\(|\$validos|\$ventanas|allowedIntervals|intervalosPermitidos|ventanasValidas)\b/i;
    const VENTANA_WHITELIST = 40;

    for (let i = 0; i < lineas.length; i++) {
        if (esComentario(lineas[i])) {
            continue;
        }
        if (tieneSentinelDisable(lineas, i, 'interval-sin-whitelist')) {
            continue;
        }
        if (lineas[i].includes('sentinel-disable interval-sin-whitelist')) {
            continue;
        }

        if (regexInterval.test(lineas[i]) || regexInterval2.test(lineas[i])) {
            let tieneWhitelist = false;
            const inicioVentana = Math.max(0, i - VENTANA_WHITELIST);
            for (let j = inicioVentana; j < i; j++) {
                if (regexWhitelist.test(lineas[j])) {
                    tieneWhitelist = true;
                    break;
                }
            }

            if (!tieneWhitelist) {
                violaciones.push({
                    reglaId: 'interval-sin-whitelist',
                    mensaje: 'INTERVAL con variable interpolada sin whitelist. Vector de inyeccion SQL. Validar con in_array() contra valores permitidos.',
                    severidad: obtenerSeveridadRegla('interval-sin-whitelist'),
                    linea: i,
                    sugerencia: "Agregar whitelist: $validos = ['7 days', '30 days']; if (!in_array($intervalo, $validos, true)) $intervalo = '30 days';",
                    fuente: 'estatico'
                });
            }
        }
    }

    return violaciones;
}

/* ====================================================================
 * OPEN REDIRECT
 * Detecta wp_redirect() o header('Location:') con variable sin validar.
 * ==================================================================== */

export function verificarOpenRedirect(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];

    const regexWpRedirect = /\bwp_redirect\s*\(\s*\$/;
    const regexHeaderLocation = /\bheader\s*\(\s*['"]Location:\s*['"]?\s*\.\s*\$/i;
    const regexValidacion = /\b(wp_validate_redirect|wp_safe_redirect|esc_url|filter_var\s*\([^,]*,\s*FILTER_VALIDATE_URL)\b/;
    const VENTANA_VALIDACION = 5;

    for (let i = 0; i < lineas.length; i++) {
        if (esComentario(lineas[i])) {
            continue;
        }
        if (tieneSentinelDisable(lineas, i, 'open-redirect')) {
            continue;
        }
        if (lineas[i].includes('sentinel-disable open-redirect')) {
            continue;
        }

        const esRedirectInseguro = regexWpRedirect.test(lineas[i]) || regexHeaderLocation.test(lineas[i]);
        if (!esRedirectInseguro) {
            continue;
        }

        if (/\bwp_safe_redirect\b/.test(lineas[i])) {
            continue;
        }

        const regexUrlInterna = /\b(wp_login_url|home_url|admin_url|get_permalink|site_url|network_site_url|get_post_permalink|wp_logout_url)\s*\(/;
        if (regexUrlInterna.test(lineas[i])) {
            continue;
        }

        /* Verificar si la variable viene de funcion interna segura */
        const matchVar = /wp_redirect\s*\(\s*(\$\w+)/.exec(lineas[i]);
        if (matchVar) {
            const nombreVar = matchVar[1].replace('$', '\\$');
            const regexAsignacionSegura = new RegExp(`${nombreVar}\\s*=\\s*(wp_login_url|home_url|admin_url|get_permalink|site_url|network_site_url|wp_logout_url)\\s*\\(`);
            let origenSeguro = false;
            for (let j = Math.max(0, i - 8); j < i; j++) {
                if (regexAsignacionSegura.test(lineas[j])) {
                    origenSeguro = true;
                    break;
                }
            }
            if (origenSeguro) {
                continue;
            }
        }

        let tieneValidacion = false;
        const inicioVentana = Math.max(0, i - VENTANA_VALIDACION);
        const finVentana = Math.min(lineas.length, i + VENTANA_VALIDACION);
        for (let j = inicioVentana; j < finVentana; j++) {
            if (regexValidacion.test(lineas[j])) {
                tieneValidacion = true;
                break;
            }
        }

        if (!tieneValidacion) {
            violaciones.push({
                reglaId: 'open-redirect',
                mensaje: 'Redireccion con URL no validada. Riesgo de Open Redirect. Usar wp_safe_redirect() o wp_validate_redirect().',
                severidad: obtenerSeveridadRegla('open-redirect'),
                linea: i,
                sugerencia: 'Usar wp_safe_redirect($url) o validar con wp_validate_redirect($url, home_url()).',
                fuente: 'estatico'
            });
        }
    }

    return violaciones;
}

/* ====================================================================
 * RETURN VOID CRITICO
 * Detecta metodos publicos que hacen INSERT/UPDATE/DELETE pero retornan void.
 * ==================================================================== */

export function verificarReturnVoidCritico(texto: string, lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];

    const regexMetodoPublico = /public\s+function\s+(\w+)\s*\([^)]*\)\s*(?::\s*(\w+))?\s*\{/g;

    let match: RegExpExecArray | null;
    while ((match = regexMetodoPublico.exec(texto)) !== null) {
        const nombreMetodo = match[1];
        const returnType = match[2] || null;

        if (returnType !== null && returnType !== 'void') {
            continue;
        }

        const posicion = match.index;
        const lineaSignature = texto.substring(0, posicion).split('\n').length - 1;

        if (tieneSentinelDisable(lineas, lineaSignature, 'return-void-critico')) {
            continue;
        }

        /* Encontrar el cuerpo del metodo */
        const inicioBody = texto.indexOf('{', posicion + match[0].length - 1);
        if (inicioBody === -1) {
            continue;
        }

        let profundidad = 1;
        let pos = inicioBody + 1;
        while (pos < texto.length && profundidad > 0) {
            if (texto[pos] === '{') {
                profundidad++;
            } else if (texto[pos] === '}') {
                profundidad--;
            }
            pos++;
        }

        const cuerpo = texto.substring(inicioBody, pos);

        if (/^(__construct|register(Routes)?|registrar(Rutas)?)$/i.test(nombreMetodo)) {
            continue;
        }

        const tieneEscritura = /\b(INSERT|UPDATE|DELETE|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE|->insertar\(|->actualizar\(|->eliminar\(|->insert\(|->update\(|->delete\(|->query\(.*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP))/i.test(cuerpo);

        if (tieneEscritura) {
            const tipoActual = returnType === 'void' ? 'void' : 'sin return type';
            violaciones.push({
                reglaId: 'return-void-critico',
                mensaje: `Metodo '${nombreMetodo}()' hace operaciones de escritura pero retorna ${tipoActual}. El caller no puede verificar exito/fallo.`,
                severidad: obtenerSeveridadRegla('return-void-critico'),
                linea: lineaSignature,
                sugerencia: `Cambiar return type a bool o un tipo que indique resultado de la operacion.`,
                fuente: 'estatico'
            });
        }
    }

    return violaciones;
}

/* ====================================================================
 * N+1 QUERY
 * Detecta queries dentro de loops (foreach, for, while).
 * ==================================================================== */

export function verificarNPlus1Query(lineas: string[], rutaArchivo?: string): Violacion[] {
    const violaciones: Violacion[] = [];

    const regexLoop = /\b(foreach|for|while)\s*\(/;
    const regexQuery = /(\$this->pg|\$wpdb->|->ejecutar\(|->buscarPorId\(|->get_results\(|->get_var\(|->get_row\(|->query\()/;
    const regexCache = /(\$cache|wp_cache_get|cache_get|Redis::|Memcached::|static\s+\$cache)/;

    const lineasYaReportadas = new Set<number>();

    const nombreArchivo = path.basename(rutaArchivo || '');
    if (/Seeder/i.test(nombreArchivo)) {
        return violaciones;
    }

    for (let i = 0; i < lineas.length; i++) {
        if (esComentario(lineas[i])) {
            continue;
        }
        if (!regexLoop.test(lineas[i])) {
            continue;
        }
        if (tieneSentinelDisable(lineas, i, 'n-plus-1-query')) {
            continue;
        }

        let llaves = 0;
        let tieneQuery = false;
        let tieneCache = false;
        let lineaQuery = -1;
        let encontroCuerpo = false;
        let finBloque = i;

        for (let j = i; j < Math.min(lineas.length, i + 60); j++) {
            for (const char of lineas[j]) {
                if (char === '{') {
                    llaves++;
                    encontroCuerpo = true;
                }
                if (char === '}') {
                    llaves--;
                }
            }

            if (j > i && encontroCuerpo) {
                if (regexQuery.test(lineas[j]) && lineaQuery === -1) {
                    tieneQuery = true;
                    lineaQuery = j;
                }
                if (regexCache.test(lineas[j])) {
                    tieneCache = true;
                }
            }

            if (encontroCuerpo && llaves <= 0) {
                finBloque = j;
                break;
            }
        }

        if (tieneQuery && !tieneCache && lineaQuery !== -1 && !lineasYaReportadas.has(lineaQuery)) {
            lineasYaReportadas.add(lineaQuery);
            violaciones.push({
                reglaId: 'n-plus-1-query',
                mensaje: 'Query dentro de loop (N+1). Usar batch query, JOIN o cache para evitar overhead de red.',
                severidad: obtenerSeveridadRegla('n-plus-1-query'),
                linea: lineaQuery,
                sugerencia: 'Extraer la query fuera del loop: obtener todos los registros de una vez y filtrar en memoria.',
                fuente: 'estatico'
            });
        }

        if (finBloque > i) {
            i = finBloque;
        }
    }

    return violaciones;
}

/* ====================================================================
 * FQN INLINE
 * Detecta Fully Qualified Names inline en vez de use statements.
 * ==================================================================== */

export function verificarFqnInline(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];
    let pasadoUseStatements = false;

    for (let i = 0; i < lineas.length; i++) {
        if (esComentario(lineas[i])) {
            continue;
        }

        const lineaTrimmed = lineas[i].trim();
        if (/^(class |abstract\s+class |final\s+class |function |namespace )/.test(lineaTrimmed)) {
            pasadoUseStatements = true;
        }

        if (/^namespace\s+/.test(lineaTrimmed)) {
            continue;
        }
        if (!pasadoUseStatements) {
            continue;
        }
        if (tieneSentinelDisable(lineas, i, 'controller-fqn-inline')) {
            continue;
        }

        if (/\\(App|Glory)\\/.test(lineas[i])) {
            if (/^use\s+/.test(lineaTrimmed)) {
                continue;
            }
            if (/['"]\/?(App|Glory)\//.test(lineas[i])) {
                continue;
            }
            if (/instanceof/.test(lineas[i])) {
                continue;
            }
            if (/@\w+/.test(lineaTrimmed)) {
                continue;
            }

            violaciones.push({
                reglaId: 'controller-fqn-inline',
                mensaje: 'FQN inline (\\App\\ o \\Glory\\). Usar "use" statement al inicio del archivo.',
                severidad: obtenerSeveridadRegla('controller-fqn-inline'),
                linea: i,
                fuente: 'estatico'
            });
        }
    }

    return violaciones;
}

/* ====================================================================
 * PHP SIN RETURN TYPE
 * Detecta funciones publicas sin return type declaration.
 * ==================================================================== */

export function verificarPhpSinReturnType(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];

    for (let i = 0; i < lineas.length; i++) {
        if (tieneSentinelDisable(lineas, i, 'php-sin-return-type')) {
            continue;
        }

        const match = /public\s+function\s+(\w+)\s*\([^)]*\)\s*\{/.exec(lineas[i]);
        if (!match) {
            continue;
        }

        const nombre = match[1];
        if (/^(__construct|__destruct|__clone|__toString|__get|__set|__isset|__unset|setUp|tearDown)$/.test(nombre)) {
            continue;
        }

        if (/\)\s*:\s*\S+\s*\{/.test(lineas[i])) {
            continue;
        }

        let tieneDocReturn = false;
        for (let j = Math.max(0, i - 10); j < i; j++) {
            if (/@return/.test(lineas[j])) {
                tieneDocReturn = true;
                break;
            }
        }

        const msgExtra = tieneDocReturn ? ' (tiene @return en docblock, agregar type hint nativo)' : '';
        violaciones.push({
            reglaId: 'php-sin-return-type',
            mensaje: `Funcion publica '${nombre}()' sin return type declaration.${msgExtra}`,
            severidad: obtenerSeveridadRegla('php-sin-return-type'),
            linea: i,
            sugerencia: `Agregar ': tipo' despues de los parentesis, antes de '{'. Ej: public function ${nombre}(): bool {`,
            fuente: 'estatico'
        });
    }

    return violaciones;
}

/* ====================================================================
 * SELECT * (REPOSITORY SIN WHITELIST COLUMNAS)
 * Detecta SELECT * FROM que no lista columnas explicitas.
 * ==================================================================== */

export function verificarSelectStar(lineas: string[], rutaArchivo: string): Violacion[] {
    const violaciones: Violacion[] = [];

    if (rutaArchivo.includes('_generated/') || rutaArchivo.includes('/migrations/') || rutaArchivo.includes('/seeders/') || rutaArchivo.includes('BaseRepository.php')) {
        return [];
    }

    const textoCompleto = lineas.join('\n');
    const tieneSeccionAutoGenerada = textoCompleto.includes('SECCION AUTO-GENERADA');
    let enSeccionAutoGenerada = false;

    for (let i = 0; i < lineas.length; i++) {
        const lineaTrimmed = lineas[i].trim();

        if (lineaTrimmed.includes('SECCION AUTO-GENERADA') && tieneSeccionAutoGenerada) {
            enSeccionAutoGenerada = true;
        }
        if (lineaTrimmed.includes('METODOS CUSTOM') || lineaTrimmed.includes('=== CUSTOM')) {
            enSeccionAutoGenerada = false;
        }

        if (esComentario(lineas[i])) {
            continue;
        }
        if (enSeccionAutoGenerada) {
            continue;
        }
        if (tieneSentinelDisable(lineas, i, 'repository-sin-whitelist-columnas')) {
            continue;
        }

        if (/SELECT\s+\*\s+FROM/i.test(lineas[i])) {
            /* Excluir SELECT * FROM sobre CTEs */
            const matchCte = lineas[i].trim().match(/SELECT\s+\*\s+FROM\s+(\w+)/i);
            if (matchCte) {
                const nombreTabla = matchCte[1];
                if (!nombreTabla.includes('_') && nombreTabla[0] === nombreTabla[0].toLowerCase()) {
                    continue;
                }
            }

            violaciones.push({
                reglaId: 'repository-sin-whitelist-columnas',
                mensaje: 'SELECT * FROM no lista columnas explicitas. Especificar columnas para eficiencia y evitar breaking changes.',
                severidad: obtenerSeveridadRegla('repository-sin-whitelist-columnas'),
                linea: i,
                sugerencia: 'Reemplazar * con las columnas especificas que necesitas: SELECT col1, col2 FROM ...',
                fuente: 'estatico'
            });
        }
    }

    return violaciones;
}
