/*
 * Reglas de forma de arrays PHP.
 *
 * Detectan patrones en controllers PHP donde se construyen arrays asociativos
 * que probablemente deberian ser arrays indexados (porque el frontend los
 * consumira con .map(), .length, etc.).
 *
 * Regla: php-array-asociativo-como-lista
 *   Detecta cuando un metodo de controller construye un array con
 *   $result[$key] = value y lo retorna en WP_REST_Response como valor
 *   de una clave que semanticamente es una lista (dias, precios, vehiculos, etc.).
 *
 * Esta regla complementa a api-shape-mismatch (que detecta desde el lado TS)
 * con deteccion directa en el PHP para dar feedback inmediato al editar PHP.
 */

import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';

/*
 * Nombres de claves que semanticamente son listas (arrays indexados).
 * Si PHP devuelve un array asociativo para estas claves, es probablemente un bug.
 */
const CLAVES_LISTA = new Set([
  'dias', 'vehiculos', 'reservas', 'clientes', 'precios',
  'desglose', 'items', 'resultados', 'actividades', 'eventos',
  'galeria', 'imagenes', 'archivos', 'notificaciones', 'opciones',
  'calendario', 'horarios', 'extras', 'equipamiento', 'temporadas',
  'conflictos', 'errores', 'warnings', 'pagos', 'notas',
]);

/*
 * Detecta metodos PHP en controllers que construyen arrays asociativos
 * y los retornan como valor de claves que deberian ser listas.
 *
 * Patron peligroso:
 *   $calendario[$fecha] = !isset($reservas[$fecha]);   // asociativo
 *   return new WP_REST_Response(['dias' => $calendario], 200);
 *
 * Patron correcto:
 *   $calendario[] = ['dia' => ..., 'disponible' => ...]; // indexado
 *   return new WP_REST_Response(['dias' => $calendario], 200);
 *
 * Tambien detecta metodos que retornan arrays asociativos directamente si
 * el metodo se llama desde un controller.
 */
export function verificarArrayAsociativoComoLista(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Solo aplicar a controllers */
  const esController = lineas.some(l => /class\s+\w*(Controller|Endpoints)\b/.test(l));
  if (!esController) { return violaciones; }

  /*
   * Paso 1: Identificar variables construidas con patron asociativo.
   * Buscar: $variable[$key] = ...  (donde $key es variable o string, no vacio [])
   */
  const variablesAsociativas = new Map<string, number>(); /* nombre → primera linea */
  const variablesIndexadas = new Set<string>();

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* $var[$key] = ... (asociativo) */
    const matchAsoc = /\$(\w+)\[(?:\$\w+|['"][^'"]+['"])\]\s*=/.exec(linea);
    if (matchAsoc && !esComentario(linea.trim())) {
      const nombre = matchAsoc[1];
      if (!variablesAsociativas.has(nombre)) {
        variablesAsociativas.set(nombre, i);
      }
    }

    /* $var[] = ... (indexado) — marca como segura */
    const matchIdx = /\$(\w+)\[\]\s*=/.exec(linea);
    if (matchIdx) {
      variablesIndexadas.add(matchIdx[1]);
    }
  }

  /* Quitar variables que tambien usan append (mixtas, no reportar) */
  for (const nombre of variablesIndexadas) {
    variablesAsociativas.delete(nombre);
  }

  /*
   * Paso 2: Buscar WP_REST_Response donde esas variables se usan
   * como valor de claves que deberian ser listas.
   */
  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i].trim())) { continue; }
    if (tieneSentinelDisable(lineas, i, 'php-array-asociativo-como-lista')) { continue; }

    if (!/new\s+WP_REST_Response|WP_REST_Response\s*\(/.test(lineas[i])) {
      continue;
    }

    /* Buscar claves en las lineas cercanas del response */
    for (let j = i; j < Math.min(i + 20, lineas.length); j++) {
      const lineaResp = lineas[j];
      const matchClave = /['"](\w+)['"]\s*=>\s*\$(\w+)/.exec(lineaResp);
      if (!matchClave) { continue; }

      const clave = matchClave[1];
      const variable = matchClave[2];

      /* Solo reportar si la clave es semanticamente una lista Y la variable es asociativa */
      if (CLAVES_LISTA.has(clave) && variablesAsociativas.has(variable)) {
        const lineaAsoc = variablesAsociativas.get(variable)!;
        violaciones.push({
          reglaId: 'php-array-asociativo-como-lista',
          mensaje: `'${clave}' usa $${variable} construido como array asociativo (linea ${lineaAsoc + 1}). ` +
            `Esto produce un objeto JSON {} que rompe .map()/.length en el frontend. ` +
            `Usar $${variable}[] = [...] para producir un array JSON [].`,
          severidad: obtenerSeveridadRegla('php-array-asociativo-como-lista'),
          linea: j,
          sugerencia: `Cambiar $${variable}[$key] = valor por $${variable}[] = ['campo' => ...] ` +
            `o aplicar array_values($${variable}) antes de retornar.`,
          fuente: 'estatico',
        });
      }
    }
  }

  /*
   * Paso 3: Detectar metodos helper que retornan arrays asociativos
   * cuando su retorno se usa como valor de claves lista en WP_REST_Response.
   *
   * Patron:
   *   'precios' => PrecioService::tablaPreciosVehiculo(...)
   *   donde tablaPreciosVehiculo usa $tabla[$key] = ...
   *
   * Esto requiere cruzar archivos, asi que se hace via el indexer.
   * Aqui solo detectamos el patron local (dentro del mismo archivo).
   */
  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i].trim())) { continue; }
    if (tieneSentinelDisable(lineas, i, 'php-array-asociativo-como-lista')) { continue; }

    /* Buscar: 'claveLista' => self::metodo(...) o static::metodo(...) */
    const matchHelper = /['"](\w+)['"]\s*=>\s*(?:self|static)::(\w+)\s*\(/.exec(lineas[i]);
    if (!matchHelper) { continue; }

    const clave = matchHelper[1];
    const metodo = matchHelper[2];

    if (!CLAVES_LISTA.has(clave)) { continue; }

    /* Buscar el metodo en el mismo archivo y verificar si produce asociativo */
    const textoCompleto = lineas.join('\n');
    const shape = analizarShapeMetodoLocal(metodo, textoCompleto);

    if (shape === 'asociativo') {
      violaciones.push({
        reglaId: 'php-array-asociativo-como-lista',
        mensaje: `'${clave}' usa ${metodo}() que retorna array asociativo. ` +
          `En JSON se serializa como {} rompiendo .map() en el frontend.`,
        severidad: obtenerSeveridadRegla('php-array-asociativo-como-lista'),
        linea: i,
        sugerencia: `Corregir ${metodo}() para usar $result[] = ... en vez de $result[$key] = ..., ` +
          `o aplicar array_values() al retorno.`,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Analiza un metodo local para determinar si produce array asociativo o indexado.
 */
function analizarShapeMetodoLocal(nombre: string, contenido: string): 'indexado' | 'asociativo' | 'desconocido' {
  const regexMetodo = new RegExp(`function\\s+${nombre}\\s*\\([^)]*\\)[^{]*\\{`, 's');
  const matchMetodo = regexMetodo.exec(contenido);
  if (!matchMetodo) { return 'desconocido'; }

  /* Extraer cuerpo */
  const inicio = matchMetodo.index + matchMetodo[0].length;
  let profundidad = 1;
  let fin = inicio;
  for (let i = inicio; i < contenido.length && profundidad > 0; i++) {
    if (contenido[i] === '{') { profundidad++; }
    if (contenido[i] === '}') { profundidad--; }
    fin = i;
  }
  const cuerpo = contenido.slice(inicio, fin);

  const tieneAppend = /\$\w+\[\]\s*=/.test(cuerpo);
  const tieneAsociativo = /\$\w+\[\$\w+\]\s*=|\$\w+\[['"]/.test(cuerpo);

  if (tieneAsociativo && !tieneAppend) { return 'asociativo'; }
  if (tieneAppend && !tieneAsociativo) { return 'indexado'; }

  return 'desconocido';
}

/*
 * Detecta metodos en Services/Repositories que retornan arrays asociativos
 * cuando el nombre del metodo sugiere que deberia ser una lista.
 *
 * Regla: php-service-retorna-asociativo
 *   Detecta funciones cuyo nombre contiene 'calendario', 'lista', 'tabla', 'todos'
 *   que construyen arrays con $arr[$key] = valor.
 */
export function verificarServiceRetornaAsociativo(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Nombres de metodos que semanticamente deberian retornar listas */
  const regexNombreLista = /\b(calendario|lista|tabla|todos|listar|obtenerTodos|getAll|getList|buscar|filtrar)\w*/i;

  const regexMetodo = /(?:public\s+)?(?:static\s+)?function\s+(\w+)\s*\(/;

  let metodoActual: string | null = null;
  let metodoLinea = 0;
  let profundidad = 0;
  let dentroDeMetodo = false;
  let tieneAsociativo = false;
  let tieneIndexado = false;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    const matchMetodo = regexMetodo.exec(linea);
    if (matchMetodo) {
      /* Cerrar metodo anterior si habia */
      if (metodoActual && dentroDeMetodo && tieneAsociativo && !tieneIndexado) {
        if (regexNombreLista.test(metodoActual)) {
          if (!tieneSentinelDisable(lineas, metodoLinea, 'php-service-retorna-asociativo')) {
            violaciones.push({
              reglaId: 'php-service-retorna-asociativo',
              mensaje: `${metodoActual}() construye array asociativo ($arr[$key] = ...) pero el nombre sugiere lista. ` +
                `En JSON se serializa como {} y causa 'h.map is not a function' en React.`,
              severidad: obtenerSeveridadRegla('php-service-retorna-asociativo'),
              linea: metodoLinea,
              sugerencia: `Usar $arr[] = [...] para producir array JSON indexado [].`,
              fuente: 'estatico',
            });
          }
        }
      }

      metodoActual = matchMetodo[1];
      metodoLinea = i;
      profundidad = 0;
      dentroDeMetodo = false;
      tieneAsociativo = false;
      tieneIndexado = false;
    }

    for (const c of linea) {
      if (c === '{') {
        if (metodoActual && !dentroDeMetodo) { dentroDeMetodo = true; }
        profundidad++;
      }
      if (c === '}') { profundidad--; }
    }

    if (dentroDeMetodo) {
      /* Detectar $var[$key] = ... (asociativo) — excluir params de query y foreach */
      if (/\$\w+\[(?:\$\w+|['"][^'"]+['"])\]\s*=/.test(linea) && !esComentario(linea.trim())) {
        /* Excluir variables comunes de parametros (PDO/request/config) */
        const esParamVar = /\$(?:params|args|where|datos|body|options|headers|filtros|paramsCount)\[/.test(linea);
        /* Excluir modificaciones dentro de foreach (iteracion por referencia) */
        let esDentroForeach = false;
        for (let k = i - 1; k >= Math.max(0, i - 10); k--) {
          if (/foreach\s*\(/.test(lineas[k])) { esDentroForeach = true; break; }
          if (/^\s*(?:public|private|protected|static|function)\b/.test(lineas[k])) { break; }
        }
        if (!esParamVar && !esDentroForeach) {
          tieneAsociativo = true;
        }
      }
      /* Detectar $var[] = ... (indexado) */
      if (/\$\w+\[\]\s*=/.test(linea)) {
        tieneIndexado = true;
      }
    }

    if (dentroDeMetodo && profundidad <= 0) {
      /* Fin del metodo — verificar */
      if (metodoActual && tieneAsociativo && !tieneIndexado) {
        if (regexNombreLista.test(metodoActual)) {
          if (!tieneSentinelDisable(lineas, metodoLinea, 'php-service-retorna-asociativo')) {
            violaciones.push({
              reglaId: 'php-service-retorna-asociativo',
              mensaje: `${metodoActual}() construye array asociativo pero el nombre sugiere lista. ` +
                `En JSON, un array asociativo se serializa como objeto {} y causa TypeError en .map().`,
              severidad: obtenerSeveridadRegla('php-service-retorna-asociativo'),
              linea: metodoLinea,
              sugerencia: `Usar $arr[] = ['campo' => ...] o aplicar array_values() al retorno.`,
              fuente: 'estatico',
            });
          }
        }
      }
      metodoActual = null;
      dentroDeMetodo = false;
    }
  }

  return violaciones;
}
