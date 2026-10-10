/*
 * [08AA-26] sqlx-query-sin-macro / sqlx-query-as-sin-macro no deben disparar
 * dentro de #[cfg(test)]: el SQL de fixtures usa sqlx::query en runtime a
 * proposito. En produccion sigue disparando.
 */

import * as assert from 'assert';
import { reglasEstaticas } from '../../config/defaultRules';
import { analizarEstatico } from '../../analyzers/staticAnalyzer';

function crearDocumento(texto: string, fileName = 'src/repositories/chat.rs') {
  const lineas = texto.split('\n');

  return {
    fileName,
    lineCount: lineas.length,
    getText: () => texto,
    lineAt: (line: number) => ({ text: lineas[line] ?? '' }),
    positionAt: (offset: number) => {
      const previo = texto.slice(0, offset);
      const partes = previo.split('\n');
      return {
        line: partes.length - 1,
        character: partes[partes.length - 1]?.length ?? 0,
      };
    },
  } as never;
}

function contarSqlx(texto: string, fileName?: string): number {
  const reglas = ['sqlx-query-sin-macro', 'sqlx-query-as-sin-macro']
    .map(id => reglasEstaticas.find(r => r.id === id));
  assert.ok(reglas.every(Boolean), 'Las reglas sqlx deben existir');

  return analizarEstatico(crearDocumento(texto, fileName), reglas as never[])
    .filter(v => v.reglaId.startsWith('sqlx-query')).length;
}

suite('sqlx-*-sin-macro ignoran SQL dentro de #[cfg(test)]', () => {
  test('sqlx::query en produccion sigue disparando', () => {
    assert.strictEqual(contarSqlx('pub fn listar() {\n  sqlx::query("SELECT 1");\n}'), 1);
  });

  test('sqlx::query y query_as dentro de mod #[cfg(test)] no disparan', () => {
    const texto = [
      'pub fn ping() -> u8 { 1 }',
      '#[cfg(test)]',
      'mod pruebas {',
      '  #[tokio::test]',
      '  async fn t01(pool: PgPool) {',
      '    sqlx::query("DELETE FROM t").execute(&pool).await.unwrap();',
      '    let _ = sqlx::query_as::<_, Row>("SELECT * FROM t").fetch_all(&pool).await;',
      '  }',
      '}',
    ].join('\n');
    assert.strictEqual(contarSqlx(texto), 0);
  });

  test('con produccion y test en el mismo archivo, solo cuenta la de produccion', () => {
    const texto = [
      'pub fn listar() {',
      '  sqlx::query("SELECT 1");',
      '}',
      '#[cfg(test)]',
      'mod pruebas {',
      '  fn t() {',
      '    sqlx::query("SELECT 2");',
      '  }',
      '}',
    ].join('\n');
    assert.strictEqual(contarSqlx(texto), 1);
  });

  test('archivo #![cfg(test)] entero no dispara', () => {
    const texto = '#![cfg(test)]\nasync fn t(pool: PgPool) {\n  sqlx::query("SELECT 1").execute(&pool).await.unwrap();\n}';
    assert.strictEqual(contarSqlx(texto), 0);
  });

  test('tests de integracion del crate (tests/*.rs) no disparan, con ruta POSIX o Windows', () => {
    const texto = 'async fn humo(pool: PgPool) {\n  sqlx::query("SELECT 1").execute(&pool).await.unwrap();\n}';
    assert.strictEqual(contarSqlx(texto, 'tests/chat_humo.rs'), 0);
    assert.strictEqual(contarSqlx(texto, 'tests\\chat_humo.rs'), 0);
  });

  test('un modulo de produccion llamado tests.rs sigue disparando', () => {
    const texto = 'pub fn listar() {\n  sqlx::query("SELECT 1");\n}';
    assert.strictEqual(contarSqlx(texto, 'src/repositories/tests.rs'), 1);
  });
});
