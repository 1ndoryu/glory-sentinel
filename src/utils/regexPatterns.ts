/*
 * Patrones regex reutilizables para el analisis estatico.
 * Organizados por categoria y tipo de archivo.
 */

/* PHP: Supresor @ antes de funciones peligrosas */
export const PHP_SUPRESOR_AT = /@(unlink|file_get_contents|fopen|fclose|mkdir|rmdir|copy|rename|readfile|glob|file_put_contents|chmod|chown)\s*\(/g;

/* PHP: Supresor @ generico (cualquier funcion) */
export const PHP_SUPRESOR_AT_GENERICO = /@[a-zA-Z_]\w*\s*\(/g;

/* PHP: $wpdb sin prepare - detecta llamadas directas sin prepare envolvente */
export const PHP_WPDB_SIN_PREPARE = /\$wpdb\s*->\s*(query|get_var|get_results|get_row|get_col)\s*\(/g;

/* PHP: Verificar si la linea contiene prepare (para descartar falsos positivos) */
export const PHP_WPDB_CON_PREPARE = /\$wpdb\s*->\s*prepare\s*\(/;

/* General: eval() */
export const EVAL_CALL = /\beval\s*\(/g;

/*
 * JS/TS: innerHTML con variable (no string literal).
 * Usa clase negada en vez de lookahead para evitar que el backtracking
 * de \s* haga que la lookahead evalúe el espacio en lugar del literal.
 * Requiere que el primer caracter no-espacio tras '=' no sea comilla.
 */
export const INNERHTML_VARIABLE = /\.innerHTML\s*=\s*[^'"\`\s]/g;

/* CSS inline: eliminado — VarSense maneja esta deteccion */

/*
 * Shell: git add . o git add --all.
 * Usa lookahead (?=\s|$) en vez de \b porque '\b' falla con '.' al final
 * de cadena en JS (el punto no es caracter de palabra, la posicion final
 * tampoco, por lo que no hay cambio de tipo y \b no se satisface).
 * Con (?=\s|$) tambien excluye correctamente 'git add .env.local'.
 */
export const GIT_ADD_ALL = /git\s+add\s+(\.|--all)(?=\s|$)/g;

/* JS/TS: Catch vacio */
export const CATCH_VACIO = /catch\s*\([^)]*\)\s*\{\s*\}/g;

/* General: Hardcoded password/secret/api_key/token */
export const HARDCODED_SECRET = /\b(password|secret|api_key|apikey|api_secret|token|private_key)\s*=\s*['"][^'"]{4,}['"]/gi;

/* JS/TS: console.log generico en catch (heuristico por linea, se verifica en contexto) */
export const CONSOLE_EN_CATCH = /catch\s*\([^)]*\)\s*\{[^}]*console\.(log|warn)\s*\(/gs;

/* React: useState para contar ocurrencias */
export const USE_STATE = /\buseState\s*[<(]/g;

/* Comentarios: Barras decorativas */
export const BARRAS_DECORATIVAS = /[=]{4,}|[-]{4,}(?!-)/g;

/* PHP: $request->get_json_params() pasado directamente */
export const REQUEST_JSON_DIRECTO = /\$request\s*->\s*get_json_params\s*\(\s*\)/g;

/* CSS: Detectar colores hardcodeados (hex, rgb, rgba) que deberian ser variables */
export const CSS_COLOR_HARDCODED = /(?<!var\()#[0-9a-fA-F]{3,8}\b|rgb(a)?\s*\([^)]+\)/g;

/* Import muerto: captura el nombre importado para verificar uso posterior */
export const IMPORT_NOMBRADO_JS = /import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/g;
export const IMPORT_DEFAULT_JS = /import\s+(\w+)\s+from\s+['"][^'"]+['"]/g;

/* PHP: use statement para verificar si se usa */
export const PHP_USE_STATEMENT = /^use\s+([^;]+);/gm;
