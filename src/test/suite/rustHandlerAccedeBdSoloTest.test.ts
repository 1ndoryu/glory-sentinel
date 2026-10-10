/*
 * [08AA-26] handler-accede-bd-rs (rustAnalyzer.ts) debe ignorar el SQL de
 * fixtures dentro de #[cfg(test)]: el DIP aplica a produccion. Antes
 * flaggeaba 112 lineas de tests en MN-Inmobiliaria (chat_tools.rs).
 */

import * as assert from 'assert';
import { analizarRust } from '../../analyzers/rustAnalyzer';
import { configurarOverridesReglas } from '../../config/ruleRegistry';
import { createCoreDocument } from '../../core/types';

function analyze(content: string) {
  configurarOverridesReglas({
    'handler-accede-bd-rs': { habilitada: true, severidad: 'error' },
  });
  return analizarRust(createCoreDocument({
    uri: 'file:///src/handlers/chat_tools.rs',
    fileName: '/src/handlers/chat_tools.rs',
    languageId: 'rust',
    content,
  }));
}

function contar(findings: ReturnType<typeof analyze>): number {
  return findings.filter(item => item.reglaId === 'handler-accede-bd-rs').length;
}

suite('handler-accede-bd-rs ignora SQL dentro de #[cfg(test)]', () => {
  test('SQL de produccion en un handler sigue disparando', () => {
    const findings = analyze([
      'pub async fn listar(pool: &PgPool) -> Result<Vec<Row>, Error> {',
      '  let rows = sqlx::query_as::<_, Row>("SELECT * FROM t").fetch_all(pool).await?;',
      '  Ok(rows)',
      '}',
    ].join('\n'));
    assert.strictEqual(contar(findings), 1);
  });

  test('SQL dentro de mod pruebas #[cfg(test)] al final del handler no dispara', () => {
    const findings = analyze([
      'pub fn ping() -> u8 { 1 }',
      '#[cfg(test)]',
      'mod pruebas {',
      '  use super::*;',
      '  #[tokio::test]',
      '  async fn t01_fixture(pool: PgPool) {',
      '    sqlx::query("DELETE FROM t").execute(&pool).await.unwrap();',
      '    let _ = sqlx::query_as::<_, Row>("SELECT * FROM t").fetch_all(&pool).await;',
      '  }',
      '}',
    ].join('\n'));
    assert.strictEqual(contar(findings), 0);
  });

  test('con produccion y test en el mismo archivo, solo cuenta la de produccion', () => {
    const findings = analyze([
      'pub async fn listar(pool: &PgPool) -> Result<(), Error> {',
      '  sqlx::query("SELECT 1").execute(pool).await?;',
      '  Ok(())',
      '}',
      '#[cfg(test)]',
      'mod pruebas {',
      '  #[tokio::test]',
      '  async fn t() {',
      '    sqlx::query("SELECT 2").execute(&pool).await.unwrap();',
      '  }',
      '}',
    ].join('\n'));
    assert.strictEqual(contar(findings), 1);
  });
});
