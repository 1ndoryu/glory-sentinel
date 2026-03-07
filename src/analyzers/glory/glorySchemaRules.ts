/*
 * Reglas del Schema System de Glory.
 * Detecta columnas SQL hardcodeadas, valores de enum hardcodeados y SELECT *.
 * Sugiere usar constantes Cols/Enums generadas por el Schema System.
 */

import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';
import { obtenerMapaCols, obtenerMapaEnums } from './schemaLoader';

/* Valores de columna demasiado genericos para reportar (falsos positivos) */
const COLUMNAS_IGNORADAS = new Set([
  'id', 'tipo', 'estado', 'created_at', 'updated_at', 'nombre',
  /* 'key' es ubicuo en PHP arrays y no representa una columna SQL en la mayoria de contextos */
  'key',
]);

/* Valores enum demasiado comunes para reportar (falsos positivos masivos) */
const VALORES_IGNORADOS_ENUM = new Set([
  'true', 'false', 'null', 'ok', 'error', 'id', 'key', 'type', 'name',
  'value', 'data', 'status', 'message', 'result', 'success', 'fail',
  'yes', 'no', 'on', 'off', '0', '1',
]);

/* Rutas excluidas de analisis de schema (generados, migrations, framework) */
function esRutaExcluidaSchema(ruta: string): boolean {
  return /(_generated\/|\/migrations\/|\/seeders\/|\/Glory\/)/.test(ruta);
}

/*
 * Detecta strings literales de nombres de columna en contexto SQL
 * que deberian usar constantes Cols del Schema System.
 */
export function verificarHardcodedSqlColumn(lineas: string[], rutaArchivo: string): Violacion[] {
  const violaciones: Violacion[] = [];
  const mapaCols = obtenerMapaCols();
  if (!mapaCols) { return violaciones; }

  if (esRutaExcluidaSchema(rutaArchivo)) { return violaciones; }

  const regexContextoSql = /\b(SELECT|WHERE|ORDER\s+BY|GROUP\s+BY|INSERT\s+INTO|UPDATE\s+.*SET|JOIN\s+.*ON|HAVING)\b/i;

  /* Construir set de todas las columnas conocidas con su info */
  const todasColumnas = new Map<string, { tabla: string; clase: string; constante: string }>();
  for (const [tabla, info] of Object.entries(mapaCols)) {
    for (const [valorColumna, nombreConstante] of info.columnas) {
      if (!COLUMNAS_IGNORADAS.has(valorColumna)) {
        todasColumnas.set(valorColumna, { tabla, clase: info.clase, constante: nombreConstante });
      }
    }
  }

  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i])) { continue; }
    if (tieneSentinelDisable(lineas, i, 'hardcoded-sql-column')) { continue; }

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
    if (!tieneContextoSql) { continue; }

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

        /* Excluir si el string es clave PDO (:param) o clave de array $params['col'] */
        const contextoAntes = linea.substring(Math.max(0, match.index - 15), match.index);
        if (/\[['"]?$/.test(contextoAntes) || /:\s*$/.test(contextoAntes)) { continue; }

        /* Excluir si el string es una clave de acceso JSONB (->'' o ->>'') */
        const precede3 = linea.substring(Math.max(0, match.index - 4), match.index);
        if (/->('|")$/.test(precede3) || /->>('|")$/.test(precede3)) { continue; }

        violaciones.push({
          reglaId: 'hardcoded-sql-column',
          mensaje: `Columna '${valor}' hardcodeada. Usar ${info.clase}::${info.constante} (tabla: ${info.tabla}).`,
          severidad: obtenerSeveridadRegla('hardcoded-sql-column'),
          linea: i,
          columna: match.index,
          columnaFin: match.index + match[0].length,
          sugerencia: `Reemplazar '${valor}' con ${info.clase}::${info.constante}`,
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/*
 * Detecta valores de enum hardcodeados (en comparaciones, asignaciones,
 * CASE, SQL) que deberian usar constantes Enums del Schema System.
 */
export function verificarHardcodedEnumValue(lineas: string[], rutaArchivo: string): Violacion[] {
  const violaciones: Violacion[] = [];
  const mapaEnums = obtenerMapaEnums();
  if (!mapaEnums) { return violaciones; }

  /* Excluir tests ademas de las rutas habituales */
  if (esRutaExcluidaSchema(rutaArchivo) || rutaArchivo.includes('/tests/')) {
    return violaciones;
  }

  /* Contextos donde aparecen valores de enum */
  const regexComparacion = /(?:===?|!==?)\s*['"]([a-z_]+)['"]/gi;
  const regexAsignacion = /=\s*['"]([a-z_]+)['"]\s*;/gi;
  const regexCase = /case\s+['"]([a-z_]+)['"]\s*:/gi;
  const regexSqlValor = /=\s*['"]([a-z_]+)['"]/gi;

  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i])) { continue; }
    if (tieneSentinelDisable(lineas, i, 'hardcoded-enum-value')) { continue; }

    const linea = lineas[i];
    const esLineaLog = /\b(error_log|logInfo|logWarn|logError|console\.(?:log|warn|error)|Log::)\b/.test(linea);

    const buscarEnRegex = (regex: RegExp) => {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(linea)) !== null) {
        const valor = match[1];
        if (VALORES_IGNORADOS_ENUM.has(valor.toLowerCase())) { continue; }
        if (esLineaLog) { continue; }

        const entradas = mapaEnums.get(valor);
        if (entradas && entradas.length > 0) {
          const entrada = entradas[0];
          const sugerenciaMultiple =
            entradas.length > 1
              ? ` (tambien en: ${entradas.slice(1).map(e => e.clase).join(', ')})`
              : '';

          violaciones.push({
            reglaId: 'hardcoded-enum-value',
            mensaje: `'${valor}' deberia usar ${entrada.clase}::${entrada.constante}${sugerenciaMultiple}`,
            severidad: obtenerSeveridadRegla('hardcoded-enum-value'),
            linea: i,
            columna: match.index,
            columnaFin: match.index + match[0].length,
            sugerencia: `Reemplazar '${valor}' con ${entrada.clase}::${entrada.constante}`,
            fuente: 'estatico',
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

/*
 * Detecta SELECT * FROM que no lista columnas explicitas.
 * Excluye archivos generados, migrations, BaseRepository y CTEs.
 */
export function verificarSelectStar(lineas: string[], rutaArchivo: string): Violacion[] {
  const violaciones: Violacion[] = [];

  if (esRutaExcluidaSchema(rutaArchivo) || rutaArchivo.includes('BaseRepository.php')) {
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

    if (esComentario(lineas[i])) { continue; }
    if (enSeccionAutoGenerada) { continue; }
    if (tieneSentinelDisable(lineas, i, 'repository-sin-whitelist-columnas')) { continue; }

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
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
