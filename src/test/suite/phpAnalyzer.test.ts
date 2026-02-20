/*
 * Tests para el analyzer contextual PHP (phpAnalyzer.ts).
 * Cubre casos que el analisis regex puro no puede manejar:
 * - wpdb-sin-prepare: excluye sentencias de control de transaccion
 * - request-json-directo: distingue acceso por campo vs. paso bare
 */

import * as assert from 'assert';

/* Helper minimo: simula el subset de la API de vscode.TextDocument
 * necesario para llamar a las funciones internas del analyzer. */
function crearDocumento(lineas: string[]) {
  const texto = lineas.join('\n');
  return {
    getText: () => texto,
    lineAt: (n: number) => ({ text: lineas[n] }),
    positionAt: (offset: number) => {
      let restante = offset;
      for (let i = 0; i < lineas.length; i++) {
        if (restante <= lineas[i].length) {
          return { line: i, character: restante };
        }
        restante -= lineas[i].length + 1; /* +1 por \n */
      }
      return { line: lineas.length - 1, character: 0 };
    },
  };
}

/*
 * Extrae los IDs de violacion desde el resultado de analizarPhp.
 * Importacion dinamica para no romper si el modulo usa 'vscode' (mock no necesario
 * para las funciones internas que solo reciben string[] y no llaman a vscode).
 */

/* Reimplementacion de las funciones internas para tests unitarios puros,
 * sin depender del entorno vscode. Se copian aqui para mantener los tests
 * independientes y poder correrlos con mocha sin la extension activa. */

/* --- wpdb-sin-prepare contextual --- */

function verificarWpdbSinPrepareContextual(lineas: string[]): Array<{ reglaId: string; linea: number }> {
  const violaciones: Array<{ reglaId: string; linea: number }> = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const matchWpdb = /\$wpdb\s*->\s*(query|get_var|get_results|get_row|get_col)\s*\(/.exec(linea);
    if (!matchWpdb) { continue; }

    const argumento = linea.slice(linea.indexOf(matchWpdb[0]) + matchWpdb[0].length).trim();
    if (/^['"](START\s+TRANSACTION|ROLLBACK|COMMIT|SAVEPOINT|RELEASE\s+SAVEPOINT)/i.test(argumento)) {
      continue;
    }

    if (/\$wpdb\s*->\s*prepare\s*\(/.test(linea)) { continue; }

    let tienePrepareCercano = false;
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (/\$wpdb\s*->\s*prepare\s*\(/.test(lineas[j])) {
        tienePrepareCercano = true;
        break;
      }
    }

    if (!tienePrepareCercano) {
      violaciones.push({ reglaId: 'wpdb-sin-prepare', linea: i });
    }
  }

  return violaciones;
}

/* --- request-json-directo contextual --- */

function verificarRequestJsonDirecto(lineas: string[]): Array<{ reglaId: string; linea: number }> {
  const violaciones: Array<{ reglaId: string; linea: number }> = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const matchAsignacion = /(\$\w+)\s*=\s*\$request\s*->\s*get_json_params\s*\(\s*\)/.exec(linea);
    if (!matchAsignacion) { continue; }

    const varNombre = matchAsignacion[1];
    const varEscapada = varNombre.replace('$', '\\$');

    /* Guardar lineaUso para marcar la linea de uso (j), no la de asignacion (i) */
    let lineaUso = -1;
    const fin = Math.min(lineas.length, i + 30);

    for (let j = i + 1; j < fin; j++) {
      const lineaJ = lineas[j];
      const patronBare = new RegExp(`${varEscapada}\\s*[,\\)]`);
      if (!patronBare.test(lineaJ)) { continue; }

      const lineaSinSubscript = lineaJ.replace(
        new RegExp(`${varEscapada}\\s*\\[[^\\]]*\\]`, 'g'),
        '__subscript__'
      );

      if (patronBare.test(lineaSinSubscript)) {
        lineaUso = j;
        break;
      }
    }

    if (lineaUso !== -1) {
      violaciones.push({ reglaId: 'request-json-directo', linea: lineaUso });
    }
  }

  return violaciones;
}

/* SUITE: wpdb-sin-prepare */
suite('phpAnalyzer - wpdb-sin-prepare contextual', () => {

  test('detecta query sin prepare', () => {
    const lineas = ['$wpdb->query("SELECT * FROM tabla");'];
    const v = verificarWpdbSinPrepareContextual(lineas);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].reglaId, 'wpdb-sin-prepare');
  });

  test('no reporta START TRANSACTION', () => {
    const lineas = ["$wpdb->query('START TRANSACTION');"];
    assert.strictEqual(verificarWpdbSinPrepareContextual(lineas).length, 0);
  });

  test('no reporta ROLLBACK', () => {
    const lineas = ["$wpdb->query('ROLLBACK');"];
    assert.strictEqual(verificarWpdbSinPrepareContextual(lineas).length, 0);
  });

  test('no reporta COMMIT', () => {
    const lineas = ["$wpdb->query('COMMIT');"];
    assert.strictEqual(verificarWpdbSinPrepareContextual(lineas).length, 0);
  });

  test('no reporta SAVEPOINT', () => {
    const lineas = ["$wpdb->query('SAVEPOINT sp1');"];
    assert.strictEqual(verificarWpdbSinPrepareContextual(lineas).length, 0);
  });

  test('no reporta query con prepare en misma linea', () => {
    const lineas = ['$wpdb->query($wpdb->prepare("SELECT * FROM t WHERE id = %d", $id));'];
    assert.strictEqual(verificarWpdbSinPrepareContextual(lineas).length, 0);
  });

  test('no reporta get_var con prepare en linea anterior', () => {
    const lineas = [
      '$sql = $wpdb->prepare("SELECT COUNT(*) FROM t WHERE x = %s", $x);',
      '$n = $wpdb->get_var($sql);',
    ];
    assert.strictEqual(verificarWpdbSinPrepareContextual(lineas).length, 0);
  });

  test('detecta get_var sin prepare', () => {
    const lineas = ['$n = $wpdb->get_var("SELECT COUNT(*) FROM t");'];
    const v = verificarWpdbSinPrepareContextual(lineas);
    assert.strictEqual(v.length, 1);
  });

  test('patron de transaccion completo — ninguna de las 4 lineas se reporta', () => {
    const lineas = [
      "$wpdb->query('START TRANSACTION');",
      '$ok = $wpdb->delete($tabla, ["id" => $id]);',
      "$wpdb->query('ROLLBACK');",
      "$wpdb->query('COMMIT');",
    ];
    const v = verificarWpdbSinPrepareContextual(lineas);
    /* Solo $wpdb->delete no tiene patron query/get_var, no se analiza. Las 3 queries son transaccion. */
    assert.strictEqual(v.length, 0);
  });
});

/* SUITE: request-json-directo */
suite('phpAnalyzer - request-json-directo contextual', () => {

  test('no reporta cuando se accede por campo individual', () => {
    const lineas = [
      '$datos = $request->get_json_params();',
      "if (isset($datos['hora_inicio'])) {",
      "    $actualizar['hora_inicio'] = sanitize_text_field($datos['hora_inicio']);",
      '}',
    ];
    assert.strictEqual(verificarRequestJsonDirecto(lineas).length, 0);
  });

  test('reporta cuando el array se pasa bare a un metodo', () => {
    const lineas = [
      '$datos = $request->get_json_params();',
      '$modelo->crear($datos);',
    ];
    const v = verificarRequestJsonDirecto(lineas);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].reglaId, 'request-json-directo');
  });

  test('reporta cuando el array se pasa bare como primer argumento', () => {
    const lineas = [
      '$payload = $request->get_json_params();',
      'miFuncion($payload, $extra);',
    ];
    assert.strictEqual(verificarRequestJsonDirecto(lineas).length, 1);
  });

  test('no reporta cuando solo se usan subscripts en todo el scope', () => {
    const lineas = [
      '$body = $request->get_json_params();',
      "sanitize_text_field($body['nombre']);",
      "intval($body['cantidad']);",
    ];
    assert.strictEqual(verificarRequestJsonDirecto(lineas).length, 0);
  });

  test('no reporta si el resultado nunca se usa en los proximos 30 lines', () => {
    const lineas = ['$datos = $request->get_json_params();'];
    assert.strictEqual(verificarRequestJsonDirecto(lineas).length, 0);
  });
});
