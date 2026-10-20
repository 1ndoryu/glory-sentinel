/*
 * Inferencia de la forma (array indexado/asociativo/escalar) de las claves de
 * una respuesta PHP. Extraido de apiContractIndexer.ts para acotar su tamano:
 * solo analiza texto, sin estado ni E/S.
 */

/*
 * Forma del valor de una clave en la respuesta PHP.
 * Permite distinguir si PHP devuelve un array indexado ([]) o asociativo ({}).
 */
export type ShapeValor = 'array_indexado' | 'array_asociativo' | 'escalar' | 'desconocido';

/*
 * Infiere la forma (shape) del valor de una clave en WP_REST_Response.
 *
 * Detecta patrones PHP para distinguir:
 * - array_indexado:     $data['key'] = $array (donde $array se llena con $arr[] = ...)
 *                       'key' => array_map(...)
 *                       'key' => $variable (donde $variable viene de metodo que retorna [])
 * - array_asociativo:   'key' => $data (donde $data se llena con $data[$k] = ...)
 *                       'key' => ['clave' => valor, ...]
 * - escalar:            'key' => (int), (float), (string), count(), true/false
 * - desconocido:        no se puede determinar
 */
export function inferirShapeValor(lineaResp: string, lineas: string[], lineaIdx: number, contenidoCompleto: string): ShapeValor {
  /* Extraer la parte del valor: 'clave' => VALOR */
  const matchValor = /['"]\w+['"]\s*=>\s*(.+?)\s*,?\s*$/.exec(lineaResp.trim());
  if (!matchValor) { return 'desconocido'; }
  const valor = matchValor[1].trim();

  /* Escalares directos */
  if (/^\(int\)|^\(float\)|^\(string\)|^\(bool\)|^count\(|^(true|false|null)\b|^['"]|^\d+/.test(valor)) {
    return 'escalar';
  }

  /* Array literal inline con claves string: ['clave' => ...] */
  if (/^\[/.test(valor) && /['"]\w+['"]\s*=>/.test(valor)) {
    return 'array_asociativo';
  }

  /* array_map / array_values / array_filter → generalmente array indexado */
  if (/^array_map\(|^array_values\(|^array_filter\(/.test(valor)) {
    return 'array_indexado';
  }

  /* Variable: rastrear como se construye en el metodo */
  const matchVar = /^\$(\w+)/.exec(valor);
  if (matchVar) {
    return rastrearShapeVariable(matchVar[1], lineas, lineaIdx);
  }

  /* Llamada a metodo estatico/instancia: rastrear retorno */
  const matchMetodo = /(\w+)::(\w+)\(|->(\w+)\(/.exec(valor);
  if (matchMetodo) {
    const nombreMetodo = matchMetodo[2] || matchMetodo[3];
    return rastrearShapeMetodo(nombreMetodo, contenidoCompleto);
  }

  return 'desconocido';
}

/*
 * Rastrea como se construye una variable PHP dentro del metodo actual.
 *
 * Busca hacia arriba desde la linea de referencia:
 * - $var[] = ...           → array_indexado
 * - $var[$key] = ...       → array_asociativo
 * - $var = []              → depende del uso posterior
 * - $var = array_map(...)  → array_indexado
 */
function rastrearShapeVariable(nombre: string, lineas: string[], desdeLinea: number): ShapeValor {
  const escapado = nombre.replace(/\$/g, '\\$');

  let tieneAppend = false;        /* $var[] = ... */
  let tieneClaveAsociativa = false; /* $var[$key] = ... */
  let tieneArrayMap = false;       /* $var = array_map(...) */

  /* Buscar hacia arriba, maximo 100 lineas */
  const inicio = Math.max(0, desdeLinea - 100);
  for (let i = inicio; i < desdeLinea; i++) {
    const linea = lineas[i];

    /* $var[] = valor → append indexado */
    if (new RegExp(`\\$${escapado}\\[\\]\\s*=`).test(linea)) {
      tieneAppend = true;
    }

    /* $var[$key] = valor → asociativo (donde $key no es vacio) */
    if (new RegExp(`\\$${escapado}\\[\\$\\w+\\]\\s*=|\\$${escapado}\\[['"]\\w+['"]\\]\\s*=`).test(linea)) {
      tieneClaveAsociativa = true;
    }

    /* $var = array_map(...) */
    if (new RegExp(`\\$${escapado}\\s*=\\s*array_map\\(`).test(linea)) {
      tieneArrayMap = true;
    }
  }

  if (tieneArrayMap || tieneAppend) { return 'array_indexado'; }
  if (tieneClaveAsociativa) { return 'array_asociativo'; }

  return 'desconocido';
}

/*
 * Rastrea la forma del retorno de un metodo PHP dentro del mismo archivo.
 *
 * Busca:
 * - function nombre(): array con $result[] = ... → array_indexado
 * - function nombre(): array con $result[$k] = ... → array_asociativo
 */
function rastrearShapeMetodo(nombre: string, contenido: string): ShapeValor {
  const regexMetodo = new RegExp(`function\\s+${nombre}\\s*\\([^)]*\\)[^{]*\\{`, 's');
  const matchMetodo = regexMetodo.exec(contenido);
  if (!matchMetodo) { return 'desconocido'; }

  /* Extraer cuerpo del metodo (hasta profundidad 0) */
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

  /* Si tiene ambos, el asociativo gana (es el patron que causa bugs) */
  if (tieneAsociativo && !tieneAppend) { return 'array_asociativo'; }
  if (tieneAppend && !tieneAsociativo) { return 'array_indexado'; }
  if (/array_map\(/.test(cuerpo)) { return 'array_indexado'; }

  return 'desconocido';
}
