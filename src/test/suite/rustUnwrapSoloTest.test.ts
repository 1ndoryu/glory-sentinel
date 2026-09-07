/*
 * [079A-1 F6] Tests de que unwrap-produccion-rs y panic-produccion-rs
 * (rustAnalyzer.ts) ignoran ficheros enteros de solo-test con atributo
 * interno #![cfg(test)] (p. ej. modulos de tests partidos a fichero propio).
 * Mismo criterio que 902c45e aplico a expect/block/lock; unwrap/panic
 * quedaron fuera por descuido y flaggeaban pruebas.rs (36 falsos positivos).
 */

import * as assert from 'assert';
import { analizarRust } from '../../analyzers/rustAnalyzer';
import { configurarOverridesReglas } from '../../config/ruleRegistry';
import { createCoreDocument } from '../../core/types';

function analyze(content: string) {
  configurarOverridesReglas({
    'unwrap-produccion-rs': { habilitada: true, severidad: 'error' },
    'panic-produccion-rs': { habilitada: true, severidad: 'warning' },
  });
  return analizarRust(createCoreDocument({
    uri: 'file:///src/pruebas.rs',
    fileName: '/src/pruebas.rs',
    languageId: 'rust',
    content,
  }));
}

const REGLAS = [
  'unwrap-produccion-rs',
  'panic-produccion-rs',
];

function contar(reglaId: string, findings: ReturnType<typeof analyze>): number {
  return findings.filter(item => item.reglaId === reglaId).length;
}

suite('unwrap/panic ignoran fichero solo-test (#![cfg(test)])', () => {
  test('las dos reglas ignoran un archivo completo con atributo interno cfg(test)', () => {
    const findings = analyze([
      '#![cfg(test)]',
      'use super::*;',
      '#[tokio::test]',
      'async fn t01_abrir_exitoso() {',
      '  let tool = ToolNavegadorReflejo;',
      '  let r = tool.ejecutar(&ctx(), args).await.unwrap();',
      '  assert!(r.ok);',
      '  panic!("forzar fallo visible");',
      '}',
    ].join('\n'));
    for (const regla of REGLAS) {
      assert.strictEqual(contar(regla, findings), 0, `${regla} no debe disparar en archivo solo-test`);
    }
  });

  test('el mismo codigo SIN el atributo interno si dispara (garantia anti-sobre-exclusion)', () => {
    const findings = analyze([
      'fn cargar() -> Result<String, Error> {',
      '  let v = std::fs::read_to_string("x").unwrap();',
      '  Ok(v)',
      '}',
      'fn imposible() {',
      '  todo!("pendiente");',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('unwrap-produccion-rs', findings), 1);
    assert.strictEqual(contar('panic-produccion-rs', findings), 1);
  });

  test('unwrap dentro de mod tests clasico sigue ignorado', () => {
    const findings = analyze([
      'fn cargar() {}',
      '#[cfg(test)]',
      'mod tests {',
      '  #[test]',
      '  fn t() {',
      '    let v: String = "x".to_string();',
      '    let _ = v.parse::<u32>().unwrap();',
      '  }',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('unwrap-produccion-rs', findings), 0);
  });
});
