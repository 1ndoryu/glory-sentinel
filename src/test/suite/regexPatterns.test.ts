/*
 * Tests unitarios para regexPatterns.ts.
 * Verifica que cada patron regex exportado detecta correctamente
 * los casos validos y no genera falsos positivos en codigo limpio.
 *
 * Nota: Se resetea lastIndex entre tests porque los patrones tienen flag /g.
 */

import * as assert from 'assert';
import {
  PHP_SUPRESOR_AT,
  PHP_WPDB_SIN_PREPARE,
  PHP_WPDB_CON_PREPARE,
  EVAL_CALL,
  INNERHTML_VARIABLE,
  GIT_ADD_ALL,
  CATCH_VACIO,
  HARDCODED_SECRET,
  USE_STATE,
  BARRAS_DECORATIVAS,
  REQUEST_JSON_DIRECTO,
  CSS_COLOR_HARDCODED,
} from '../../utils/regexPatterns';

/* Helper: prueba un patron global (resetea lastIndex) */
function probar(patron: RegExp, texto: string): boolean {
  patron.lastIndex = 0;
  return patron.test(texto);
}

suite('regexPatterns - PHP_SUPRESOR_AT', () => {

  test('detecta @unlink()', () => {
    assert.strictEqual(probar(PHP_SUPRESOR_AT, '@unlink($archivo)'), true);
  });

  test('detecta @file_get_contents()', () => {
    assert.strictEqual(probar(PHP_SUPRESOR_AT, '$data = @file_get_contents($url);'), true);
  });

  test('detecta @mkdir()', () => {
    assert.strictEqual(probar(PHP_SUPRESOR_AT, '@mkdir($dir, 0755, true)'), true);
  });

  test('detecta @copy()', () => {
    assert.strictEqual(probar(PHP_SUPRESOR_AT, '@copy($origen, $destino)'), true);
  });

  test('detecta @file_put_contents()', () => {
    assert.strictEqual(probar(PHP_SUPRESOR_AT, '@file_put_contents($ruta, $datos)'), true);
  });

  test('no detecta unlink() sin @', () => {
    assert.strictEqual(probar(PHP_SUPRESOR_AT, 'unlink($archivo)'), false);
  });

  test('no detecta funcion arbitraria sin @ antes de unlink-lista', () => {
    assert.strictEqual(probar(PHP_SUPRESOR_AT, 'fwrite($handle, $data)'), false);
  });
});

suite('regexPatterns - PHP_WPDB_SIN_PREPARE y PHP_WPDB_CON_PREPARE', () => {

  test('PHP_WPDB_SIN_PREPARE detecta $wpdb->query(', () => {
    assert.strictEqual(probar(PHP_WPDB_SIN_PREPARE, '$wpdb->query("SELECT * FROM tabla")'), true);
  });

  test('PHP_WPDB_SIN_PREPARE detecta $wpdb->get_var(', () => {
    assert.strictEqual(probar(PHP_WPDB_SIN_PREPARE, '$wpdb->get_var("SELECT COUNT(*)")'), true);
  });

  test('PHP_WPDB_SIN_PREPARE detecta $wpdb->get_results(', () => {
    assert.strictEqual(probar(PHP_WPDB_SIN_PREPARE, '$wpdb->get_results($sql)'), true);
  });

  test('PHP_WPDB_CON_PREPARE detecta $wpdb->prepare en la linea', () => {
    assert.strictEqual(probar(PHP_WPDB_CON_PREPARE, '$wpdb->prepare("SELECT * FROM t WHERE id=%d", $id)'), true);
  });

  test('PHP_WPDB_CON_PREPARE no coincide en cadena sin prepare', () => {
    assert.strictEqual(probar(PHP_WPDB_CON_PREPARE, '$wpdb->query($sql)'), false);
  });
});

suite('regexPatterns - EVAL_CALL', () => {

  test('detecta eval()', () => {
    assert.strictEqual(probar(EVAL_CALL, 'eval($codigo)'), true);
  });

  test('detecta eval con espacio', () => {
    assert.strictEqual(probar(EVAL_CALL, 'eval ($code)'), true);
  });

  test('no detecta evaluate()', () => {
    assert.strictEqual(probar(EVAL_CALL, 'evaluate($expr)'), false);
  });

  test('no detecta medieval()', () => {
    assert.strictEqual(probar(EVAL_CALL, 'medieval($str)'), false);
  });
});

suite('regexPatterns - INNERHTML_VARIABLE', () => {

  test('detecta innerHTML con variable', () => {
    assert.strictEqual(probar(INNERHTML_VARIABLE, 'el.innerHTML = contenido'), true);
  });

  test('detecta innerHTML con resultado de funcion', () => {
    assert.strictEqual(probar(INNERHTML_VARIABLE, 'div.innerHTML = getTemplate()'), true);
  });

  test('no detecta innerHTML con string literal doble', () => {
    assert.strictEqual(probar(INNERHTML_VARIABLE, 'el.innerHTML = "texto fijo"'), false);
  });

  test('no detecta innerHTML con string literal simple', () => {
    assert.strictEqual(probar(INNERHTML_VARIABLE, "el.innerHTML = 'texto fijo'"), false);
  });

  test('no detecta innerHTML con template literal', () => {
    assert.strictEqual(probar(INNERHTML_VARIABLE, 'el.innerHTML = `texto`'), false);
  });
});

/* css-inline-jsx eliminada: VarSense maneja esta deteccion */

suite('regexPatterns - GIT_ADD_ALL', () => {

  test('detecta git add .', () => {
    assert.strictEqual(probar(GIT_ADD_ALL, 'git add .'), true);
  });

  test('detecta git add --all', () => {
    assert.strictEqual(probar(GIT_ADD_ALL, 'git add --all'), true);
  });

  test('no detecta git add archivo.ts', () => {
    assert.strictEqual(probar(GIT_ADD_ALL, 'git add archivo.ts'), false);
  });

  test('no detecta git add src/componente.tsx', () => {
    assert.strictEqual(probar(GIT_ADD_ALL, 'git add src/componente.tsx'), false);
  });

  test('no detecta git add . dentro de nombre (git add .env.local)', () => {
    /* El patron tiene \b al final, .env.local tiene caracter despues del . */
    assert.strictEqual(probar(GIT_ADD_ALL, 'git add .env.local'), false);
  });
});

suite('regexPatterns - CATCH_VACIO', () => {

  test('detecta catch vacio simple', () => {
    assert.strictEqual(probar(CATCH_VACIO, 'catch (e) {}'), true);
  });

  test('detecta catch vacio con espacios internos', () => {
    assert.strictEqual(probar(CATCH_VACIO, 'catch (error) {  }'), true);
  });

  test('no detecta catch con console.error', () => {
    assert.strictEqual(probar(CATCH_VACIO, 'catch (e) { console.error(e); }'), false);
  });

  test('no detecta catch con throw', () => {
    assert.strictEqual(probar(CATCH_VACIO, 'catch (e) { throw e; }'), false);
  });
});

suite('regexPatterns - HARDCODED_SECRET', () => {

  test('detecta password hardcodeado con comillas dobles', () => {
    assert.strictEqual(probar(HARDCODED_SECRET, 'password = "admin1234"'), true);
  });

  test('detecta api_key hardcodeado con comillas simples', () => {
    assert.strictEqual(probar(HARDCODED_SECRET, "api_key = 'sk_live_abc123'"), true);
  });

  test('detecta token hardcodeado', () => {
    assert.strictEqual(probar(HARDCODED_SECRET, 'token = "eyJhbGciOiJIUzI1NiJ9"'), true);
  });

  test('no detecta password con valor vacio', () => {
    assert.strictEqual(probar(HARDCODED_SECRET, "password = ''"), false);
  });

  test('no detecta password con valor de 3 chars (minimo 4)', () => {
    assert.strictEqual(probar(HARDCODED_SECRET, "password = 'abc'"), false);
  });

  test('detecta secret hardcodeado case insensitive', () => {
    assert.strictEqual(probar(HARDCODED_SECRET, 'SECRET = "mi_secreto_largo"'), true);
  });
});

suite('regexPatterns - USE_STATE', () => {

  test('detecta useState<string>()', () => {
    assert.strictEqual(probar(USE_STATE, 'const [val, setVal] = useState<string>()'), true);
  });

  test('detecta useState() sin tipo', () => {
    assert.strictEqual(probar(USE_STATE, 'const [n, setN] = useState(0)'), true);
  });

  test('no detecta useStateExtended', () => {
    /* Patron \b hace que matches sean en limites de palabra */
    assert.strictEqual(probar(USE_STATE, 'useStateExtended()'), false);
  });
});

suite('regexPatterns - BARRAS_DECORATIVAS', () => {

  test('detecta ==== (4 o mas iguales)', () => {
    assert.strictEqual(probar(BARRAS_DECORATIVAS, '// ================'), true);
  });

  test('detecta ---- (4 o mas guiones)', () => {
    assert.strictEqual(probar(BARRAS_DECORATIVAS, '// ----------------'), true);
  });

  test('no detecta 3 iguales', () => {
    assert.strictEqual(probar(BARRAS_DECORATIVAS, '// ==='), false);
  });

  test('no detecta 3 guiones', () => {
    assert.strictEqual(probar(BARRAS_DECORATIVAS, '// ---'), false);
  });
});

suite('regexPatterns - REQUEST_JSON_DIRECTO', () => {

  test('detecta $request->get_json_params()', () => {
    assert.strictEqual(probar(REQUEST_JSON_DIRECTO, '$request->get_json_params()'), true);
  });

  test('detecta con espacios antes de ()', () => {
    assert.strictEqual(probar(REQUEST_JSON_DIRECTO, '$request->get_json_params( )'), true);
  });

  test('no detecta otras llamadas de $request', () => {
    assert.strictEqual(probar(REQUEST_JSON_DIRECTO, '$request->get_param("id")'), false);
  });
});

suite('regexPatterns - CSS_COLOR_HARDCODED', () => {

  test('detecta color hex de 6 digitos', () => {
    assert.strictEqual(probar(CSS_COLOR_HARDCODED, 'color: #ff0000;'), true);
  });

  test('detecta color hex de 3 digitos', () => {
    assert.strictEqual(probar(CSS_COLOR_HARDCODED, 'color: #fff;'), true);
  });

  test('detecta rgb()', () => {
    assert.strictEqual(probar(CSS_COLOR_HARDCODED, 'color: rgb(255, 0, 0);'), true);
  });

  test('detecta rgba()', () => {
    assert.strictEqual(probar(CSS_COLOR_HARDCODED, 'background: rgba(0, 0, 0, 0.5);'), true);
  });

  test('no detecta color dentro de var()', () => {
    /* El patron usa negative lookbehind (?<!var\() */
    assert.strictEqual(probar(CSS_COLOR_HARDCODED, 'color: var(--colorPrimario);'), false);
  });
});
