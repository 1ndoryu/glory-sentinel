/*
 * Regla: undefined-class-constant
 * Detecta referencias a constantes de clase PHP que no existen.
 *
 * Casos cubiertos:
 *   - self::CONSTANTE / static::CONSTANTE -- verifica en la clase actual + padre
 *   - ClaseImportada::CONSTANTE -- resuelve via 'use' statements, verifica en indice
 *   - parent::CONSTANTE -- resuelve via 'extends', verifica en clase padre
 *
 * Depende de phpConstantIndexer para la resolucion cross-file.
 */

import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';
import { obtenerConstantesDeClase, obtenerIndiceConstantes } from './phpConstantIndexer';

const REGLA_ID = 'undefined-class-constant';

/* Clases que no indexamos (vendor, WordPress, PHP builtins) -- skip silencioso */
const CLASES_EXTERNAS = new Set([
  /* PHP builtins */
  'PDO', 'DateTimeInterface', 'DateTime', 'DateTimeImmutable', 'SplFileInfo',
  'JsonSerializable', 'Serializable', 'Countable', 'Iterator', 'IteratorAggregate',
  'ArrayAccess', 'Traversable', 'Stringable', 'BackedEnum', 'UnitEnum',
  'stdClass', 'Throwable', 'Exception', 'RuntimeException', 'InvalidArgumentException',
  'LogicException', 'BadMethodCallException', 'OutOfBoundsException',
  'ZipArchive', 'CURLFile', 'ReflectionClass', 'ReflectionMethod',
  /* WordPress */
  'WP_REST_Request', 'WP_REST_Response', 'WP_Error', 'WP_Query', 'WP_Post',
  'WP_User', 'WP_Term', 'WP_Comment', 'wpdb',
  /* Vendor comunes */
  'Firebase', 'Dotenv', 'GuzzleHttp',
]);

/* Pseudo-constantes PHP que no son definidas por el usuario */
const PSEUDO_CONSTANTES = new Set(['class']);

/*
 * Extrae los 'use' statements del archivo y construye un mapa
 * de nombre corto -> nombre corto de clase (ultimo segmento del namespace).
 *
 * Ejemplo: use App\Config\Schema\_generated\SamplesCols;
 * Produce: 'SamplesCols' -> 'SamplesCols'
 *
 * Ejemplo con alias: use App\Foo\Bar as Baz;
 * Produce: 'Baz' -> 'Bar'
 */
function extraerImports(lineas: string[]): Map<string, string> {
  const mapa = new Map<string, string>();
  const regexUse = /^\s*use\s+([\w\\]+?)(?:\s+as\s+(\w+))?\s*;/;

  for (const linea of lineas) {
    const match = linea.match(regexUse);
    if (match) {
      const rutaCompleta = match[1];
      const alias = match[2];
      const segmentos = rutaCompleta.split('\\');
      const nombreReal = segmentos[segmentos.length - 1];
      const nombreCorto = alias || nombreReal;
      mapa.set(nombreCorto, nombreReal);
    }

    /* Dejar de buscar use statements despues del cuerpo de la clase */
    if (/^\s*(?:final|abstract)?\s*class\s+/.test(linea)) { break; }
  }

  return mapa;
}

/*
 * Extrae la clase definida en el archivo actual y su padre (extends).
 */
function extraerClaseActual(lineas: string[]): { nombre: string; padre: string | null } | null {
  for (const linea of lineas) {
    const match = linea.match(/(?:final|abstract)?\s*class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (match) {
      return {
        nombre: match[1],
        padre: match[2] || null,
      };
    }
  }
  return null;
}

/*
 * Extrae las constantes definidas directamente en el archivo actual.
 * Para self:: y static::, esto es mas preciso que el indice (que puede estar desactualizado).
 */
function extraerConstantesLocales(lineas: string[]): Set<string> {
  const constantes = new Set<string>();
  /* Unicode: PHP 8+ permite Ñ, É, Á, etc. en identificadores */
  const regexConst = /\bconst\s+([A-Z\u00C0-\u024F][A-Z0-9_\u00C0-\u024F]*)\s*=/;

  for (const linea of lineas) {
    const match = linea.match(regexConst);
    if (match) {
      constantes.add(match[1]);
    }
  }

  return constantes;
}

/*
 * Verifica referencias a constantes de clase indefinidas.
 * Recibe las lineas del archivo PHP siendo analizado.
 */
export function verificarUndefinedClassConstant(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  const indice = obtenerIndiceConstantes();
  if (!indice) { return violaciones; }

  /* Extraer contexto del archivo */
  const imports = extraerImports(lineas);
  const claseActual = extraerClaseActual(lineas);
  const constantesLocales = extraerConstantesLocales(lineas);

  /* Constantes del padre (para self:: y parent::) */
  let constantesPadre: Set<string> | null = null;
  if (claseActual?.padre) {
    /* Resolver nombre corto del padre via imports o usar directamente */
    const nombreRealPadre = imports.get(claseActual.padre) || claseActual.padre;
    constantesPadre = obtenerConstantesDeClase(nombreRealPadre);
  }

  /* Regex para detectar ClassName::CONSTANT_NAME (Unicode: soporta Ñ, É, Á en PHP 8+) */
  const regexRef = /\b(self|static|parent|[A-Z][\w\u00C0-\u024F]*)\s*::\s*([A-Z\u00C0-\u024F][A-Z0-9_\u00C0-\u024F]*)\b/g;

  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i])) { continue; }
    if (tieneSentinelDisable(lineas, i, REGLA_ID)) { continue; }

    const linea = lineas[i];
    regexRef.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = regexRef.exec(linea)) !== null) {
      const referencia = match[1];
      const constante = match[2];

      /* Ignorar pseudo-constantes PHP (::class) */
      if (PSEUDO_CONSTANTES.has(constante.toLowerCase())) { continue; }

      let existe = false;
      let claseResuelta = '';

      if (referencia === 'self' || referencia === 'static') {
        /* Verificar en constantes locales del archivo + padre */
        claseResuelta = claseActual?.nombre || 'self';
        existe = constantesLocales.has(constante);
        if (!existe && constantesPadre) {
          existe = constantesPadre.has(constante);
        }
      } else if (referencia === 'parent') {
        /* Verificar solo en la clase padre */
        if (!claseActual?.padre) { continue; }
        claseResuelta = claseActual.padre;
        existe = constantesPadre !== null && constantesPadre.has(constante);
      } else {
        /* Clase importada: resolver via use statements */
        const nombreReal = imports.get(referencia) || referencia;
        claseResuelta = nombreReal;

        /* Skip clases externas que no indexamos */
        if (CLASES_EXTERNAS.has(nombreReal)) { continue; }

        const constantesClase = obtenerConstantesDeClase(nombreReal);
        if (constantesClase === null) {
          /* Clase no encontrada en el indice — podria ser externa, skip */
          continue;
        }
        existe = constantesClase.has(constante);
      }

      if (!existe) {
        violaciones.push({
          reglaId: REGLA_ID,
          mensaje: `Constante indefinida: ${claseResuelta}::${constante}`,
          severidad: obtenerSeveridadRegla(REGLA_ID),
          linea: i,
          columna: match.index,
          columnaFin: match.index + match[0].length,
          sugerencia: `Verificar que ${constante} esta definida en ${claseResuelta}. Si es nueva, crearla antes de referenciarla.`,
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}
