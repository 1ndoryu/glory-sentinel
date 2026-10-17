/*
 * Tests unitarios para el analizador estatico.
 * Verifica que las reglas regex detectan correctamente cada patron.
 */

import * as assert from 'assert';
import { contarLineasEfectivas, esArchivoDeTests, obtenerLimiteArchivo } from '../../utils/lineCounter';

suite('lineCounter', () => {

  test('contarLineasEfectivas - excluye lineas vacias', () => {
    const texto = 'linea1\n\nlinea2\n\nlinea3';
    assert.strictEqual(contarLineasEfectivas(texto), 3);
  });

  test('contarLineasEfectivas - excluye comentarios de linea', () => {
    const texto = 'codigo\n// comentario\nmas codigo';
    assert.strictEqual(contarLineasEfectivas(texto), 2);
  });

  test('contarLineasEfectivas - excluye comentarios de bloque', () => {
    const texto = 'antes\n/* inicio\ncontenido\nfin */\ndespues';
    assert.strictEqual(contarLineasEfectivas(texto), 2);
  });

  test('contarLineasEfectivas - excluye comentarios de bloque en una linea', () => {
    const texto = 'antes\n/* comentario en una linea */\ndespues';
    assert.strictEqual(contarLineasEfectivas(texto), 2);
  });

  test('contarLineasEfectivas - excluye comentarios PHP con #', () => {
    const texto = 'codigo\n# comentario php\nmas codigo';
    assert.strictEqual(contarLineasEfectivas(texto), 2);
  });

  test('contarLineasEfectivas - combina todo', () => {
    const texto = [
      '<?php',
      '',
      '// Un comentario',
      '/* Bloque',
      ' * de comentarios',
      ' */',
      '',
      'class MiClase {',
      '    public function metodo() {',
      '        return true;',
      '    }',
      '}',
    ].join('\n');
    assert.strictEqual(contarLineasEfectivas(texto), 6);
  });

  test('contarLineasEfectivas - Rust: excluye el modulo de tests del final', () => {
    const texto = [
      'pub fn uno() {}',
      'pub fn dos() {}',
      '#[cfg(test)]',
      'mod pruebas {',
      '    #[test]',
      '    fn prueba() {}',
      '}',
    ].join('\n');
    assert.strictEqual(contarLineasEfectivas(texto, true), 2);
  });

  test('contarLineasEfectivas - Rust: atributo y mod en el mismo renglon', () => {
    const texto = 'pub fn uno() {}\npub fn dos() {}\n#[cfg(test)] mod pruebas;';
    assert.strictEqual(contarLineasEfectivas(texto, true), 2);
  });

  test('contarLineasEfectivas - Rust: un #[cfg(test)] de cabecera no trunca el archivo', () => {
    const texto = [
      '#[cfg(test)]',
      'use super::ayuda;',
      'pub fn uno() {}',
      'pub fn dos() {}',
      '#[cfg(test)]',
      'mod pruebas;',
    ].join('\n');
    assert.strictEqual(contarLineasEfectivas(texto, true), 3);
  });

  test('obtenerLimiteArchivo - hook detectado', () => {
    const limite = obtenerLimiteArchivo('useAlumnos.ts', '/src/hooks/useAlumnos.ts');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'hook');
    assert.strictEqual(limite?.limite, 300);
  });

  test('obtenerLimiteArchivo - util detectado', () => {
    const limite = obtenerLimiteArchivo('helpers.ts', '/src/utils/helpers.ts');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'util');
    assert.strictEqual(limite?.limite, 150);
  });

  test('obtenerLimiteArchivo - componente tsx', () => {
    const limite = obtenerLimiteArchivo('MiComponente.tsx', '/src/components/MiComponente.tsx');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'componente');
    assert.strictEqual(limite?.limite, 300);
  });

  test('obtenerLimiteArchivo - css', () => {
    const limite = obtenerLimiteArchivo('estilos.css', '/src/styles/estilos.css');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'estilo');
    assert.strictEqual(limite?.limite, 600);
  });

  test('obtenerLimiteArchivo - archivo sin limite', () => {
    const limite = obtenerLimiteArchivo('README.md', '/README.md');
    assert.strictEqual(limite, null);
  });

  /* [17AA-2] Un archivo de pruebas no es complejidad de produccion: mismo techo
   * que el harness de integracion de Rust (1000), que ya excluye `#[cfg(test)]`.
   * Antes caia en el techo de componente (300) y un test sano salia como
   * hallazgo (doctor.test.mjs 516 efectivas, remoto.test.mjs 398). */
  test('obtenerLimiteArchivo - archivo de pruebas por sufijo .test/.spec', () => {
    for (const [nombre, ruta] of [
      ['doctor.test.mjs', '/scripts/dev/doctor/doctor.test.mjs'],
      ['remoto.test.mjs', '/scripts/dev/remoto.test.mjs'],
      ['git.test.ts', '/src/server/scanner/git.test.ts'],
      ['Panel.test.tsx', '/src/v2/Panel.test.tsx'],
      ['ciclo.spec.js', '/src/ciclo.spec.js'],
    ] as const) {
      const limite = obtenerLimiteArchivo(nombre, ruta);
      assert.strictEqual(limite?.tipo, 'test-integracion', `${nombre} debe ser test-integracion`);
      assert.strictEqual(limite?.limite, 1000, `${nombre} debe tener techo 1000`);
    }
  });

  test('obtenerLimiteArchivo - archivo de pruebas por carpeta tests/__tests__', () => {
    for (const [nombre, ruta] of [
      ['git.ts', '/src/server/scanner/tests/git.ts'],
      ['ayuda.ts', '/src/__tests__/ayuda.ts'],
      ['helpers.mjs', '/scripts/helpers/tests/helpers.mjs'],
    ] as const) {
      assert.strictEqual(obtenerLimiteArchivo(nombre, ruta)?.tipo, 'test-integracion', nombre);
    }
  });

  /* El techo de pruebas va ANTES que el de hook/util: si no, `useX.test.ts`
   * caeria en hook/300 y `utils/x.test.ts` en util/150. */
  test('obtenerLimiteArchivo - el techo de pruebas gana a hook y util', () => {
    assert.strictEqual(obtenerLimiteArchivo('useAlumnos.test.ts', '/src/hooks/useAlumnos.test.ts')?.tipo, 'test-integracion');
    assert.strictEqual(obtenerLimiteArchivo('helpers.test.ts', '/src/utils/helpers.test.ts')?.tipo, 'test-integracion');
  });

  /* Testigo: el mismo barrido que detecta los tests sigue detectando produccion,
   * para que la rama nueva no se haya tragado el resto de techos. */
  test('obtenerLimiteArchivo - el codigo de produccion conserva su techo', () => {
    assert.strictEqual(obtenerLimiteArchivo('git.ts', '/src/server/scanner/git.ts')?.limite, 300);
    assert.strictEqual(obtenerLimiteArchivo('helpers.ts', '/src/utils/helpers.ts')?.limite, 150);
    assert.strictEqual(obtenerLimiteArchivo('estilos.css', '/src/styles/estilos.css')?.limite, 600);
  });

  test('esArchivoDeTests - nombre o carpeta, nunca por substring suelto', () => {
    assert.strictEqual(esArchivoDeTests('a.test.ts', '/src/a.test.ts'), true);
    assert.strictEqual(esArchivoDeTests('a.ts', '/src/__tests__/a.ts'), true);
    assert.strictEqual(esArchivoDeTests('a.ts', '/src/a.ts'), false);
    /* `test` como parte del nombre no basta: no es un archivo de pruebas. */
    assert.strictEqual(esArchivoDeTests('testimonios.ts', '/src/testimonios.ts'), false);
    assert.strictEqual(esArchivoDeTests('atest.ts', '/src/atest.ts'), false);
  });

  test('obtenerLimiteArchivo - PHP controller/endpoint', () => {
    const limite = obtenerLimiteArchivo('CapEndpoints.php', '/App/Api/CapEndpoints.php');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'controlador');
    assert.strictEqual(limite?.limite, 300);
  });

  test('obtenerLimiteArchivo - PHP service', () => {
    const limite = obtenerLimiteArchivo('StripeService.php', '/App/Services/StripeService.php');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'servicio');
    assert.strictEqual(limite?.limite, 400);
  });

  test('obtenerLimiteArchivo - PHP model', () => {
    const limite = obtenerLimiteArchivo('Alumno.php', '/App/Models/Alumno.php');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'servicio');
    assert.strictEqual(limite?.limite, 400);
  });

  test('obtenerLimiteArchivo - PHP seeder sin limite', () => {
    const limite = obtenerLimiteArchivo('CapSeeder.php', '/App/Database/CapSeeder.php');
    assert.strictEqual(limite, null);
  });

  test('obtenerLimiteArchivo - PHP schema sin limite', () => {
    const limite = obtenerLimiteArchivo('CapSchema.php', '/App/Database/CapSchema.php');
    assert.strictEqual(limite, null);
  });

  test('obtenerLimiteArchivo - PHP config sin limite', () => {
    const limite = obtenerLimiteArchivo('config.php', '/App/Config/config.php');
    assert.strictEqual(limite, null);
  });

  test('obtenerLimiteArchivo - Rust model detectado como modelo', () => {
    const limite = obtenerLimiteArchivo('hosting.rs', '/src/models/hosting.rs');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'modelo');
    assert.strictEqual(limite?.limite, 300);
  });

  test('obtenerLimiteArchivo - FP-S4: harness en /tests/ es test-integracion', () => {
    const limite = obtenerLimiteArchivo(
      'bdp_simulator_integration.rs',
      '/RESTAURANTE/tests/bdp_simulator_integration.rs',
    );
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'test-integracion');
    assert.strictEqual(limite?.limite, 1000);
  });

  test('obtenerLimiteArchivo - FP-S4: sufijo _test.rs es test-integracion', () => {
    const limite = obtenerLimiteArchivo('parser_test.rs', '/src/parser_test.rs');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'test-integracion');
    assert.strictEqual(limite?.limite, 1000);
  });

  test('obtenerLimiteArchivo - FP-S4: sufijo _tests.rs es test-integracion', () => {
    const limite = obtenerLimiteArchivo('api_tests.rs', '/src/api_tests.rs');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'test-integracion');
    assert.strictEqual(limite?.limite, 1000);
  });

  test('obtenerLimiteArchivo - FP-S4: .rs de produccion conserva default servicio/500', () => {
    const limite = obtenerLimiteArchivo('deploy_service.rs', '/src/commands/deploy_service.rs');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'servicio');
    assert.strictEqual(limite?.limite, 500);
  });
});
