/*
 * [059A-S7] Tests de las reglas Rust nuevas (rustReglasNuevas.ts):
 * expect-produccion-rs, block-en-async-rs, lock-a-traves-await-rs.
 * Cada regla con caso minimo (dispara) y caso de no-disparo.
 */

import * as assert from 'assert';
import { analizarRust } from '../../analyzers/rustAnalyzer';
import { configurarOverridesReglas } from '../../config/ruleRegistry';
import { createCoreDocument } from '../../core/types';

function analyze(content: string) {
  configurarOverridesReglas({
    'expect-produccion-rs': { habilitada: true, severidad: 'error' },
    'block-en-async-rs': { habilitada: true, severidad: 'error' },
    'lock-a-traves-await-rs': { habilitada: true, severidad: 'warning' },
  });
  return analizarRust(createCoreDocument({
    uri: 'file:///src/reglas.rs',
    fileName: '/src/reglas.rs',
    languageId: 'rust',
    content,
  }));
}

const REGLAS = [
  'expect-produccion-rs',
  'block-en-async-rs',
  'lock-a-traves-await-rs',
];

function contar(reglaId: string, findings: ReturnType<typeof analyze>): number {
  return findings.filter(item => item.reglaId === reglaId).length;
}

suite('archivos de solo-test (#![cfg(test)])', () => {
  test('las tres reglas ignoran un archivo completo con atributo interno cfg(test)', () => {
    const findings = analyze([
      '#![cfg(test)]',
      'use crate::PuertosHarness;',
      'fn mock() -> u32 {',
      '  "1".parse().expect("helper de test");',
      '  let rt = tokio::runtime::Handle::current();',
      '  rt.block_on(async {});',
      '  1',
      '}',
    ].join('\n'));
    for (const regla of REGLAS) {
      assert.strictEqual(contar(regla, findings), 0, `${regla} no debe disparar en archivo solo-test`);
    }
  });

  test('el mismo codigo SIN el atributo interno si dispara (garantia anti-sobre-exclusion)', () => {
    const findings = analyze([
      'fn mock() -> u32 {',
      '  "1".parse().expect("helper");',
      '  1',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('expect-produccion-rs', findings), 1);
  });
});

suite('expect-produccion-rs', () => {
  test('detecta .expect() fuera de tests', () => {
    const findings = analyze([
      'fn cargar() -> Result<String, Error> {',
      '  let v = std::fs::read_to_string("x")?;',
      '  let n: u32 = v.parse().expect("no es numero");',
      '  Ok(v)',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('expect-produccion-rs', findings), 1);
  });

  test('no reporta .expect() dentro de mod tests', () => {
    const findings = analyze([
      'fn cargar() {}',
      '#[cfg(test)]',
      'mod tests {',
      '  #[test]',
      '  fn t() {',
      '    let n: u32 = "1".parse().expect("ok");',
      '  }',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('expect-produccion-rs', findings), 0);
  });
});

suite('block-en-async-rs', () => {
  test('detecta Handle::block_on dentro de async fn', () => {
    const findings = analyze([
      'async fn proceso() -> Result<(), Error> {',
      '  let handle = tokio::runtime::Handle::current();',
      '  handle.block_on(async { trabajo_async().await });',
      '  Ok(())',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('block-en-async-rs', findings), 1);
  });

  test('no reporta block_on en main sincrono (uso legitimo)', () => {
    const findings = analyze([
      'fn main() {',
      '  let rt = tokio::runtime::Runtime::new().unwrap();',
      '  rt.block_on(async { trabajo_async().await });',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('block-en-async-rs', findings), 0);
  });
});

suite('lock-a-traves-await-rs', () => {
  test('detecta guard sincrono vivo a traves de .await', () => {
    const findings = analyze([
      'async fn tarea(estado: &Estado) -> Result<(), Error> {',
      '  let guard = estado.mutex.lock().unwrap();',
      '  llamada_red().await?;',
      '  Ok(())',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('lock-a-traves-await-rs', findings), 1);
  });

  test('no reporta cuando el guard se libera (drop o fin de bloque) antes del await', () => {
    const findings = analyze([
      'async fn tarea(estado: &Estado) -> Result<(), Error> {',
      '  {',
      '    let guard = estado.mutex.lock().unwrap();',
      '    let v = guard.leer();',
      '  }',
      '  llamada_red().await?;',
      '  Ok(())',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('lock-a-traves-await-rs', findings), 0);
  });
});

suite('reglas nuevas no se pisan entre si', () => {
  test('codigo limpio: cero hallazgos de las tres reglas', () => {
    const findings = analyze([
      'fn util() -> Result<u32, Error> {',
      '  let n: u32 = "1".parse()?;',
      '  Ok(n)',
      '}',
      'async fn flujo(estado: &Estado) -> Result<(), Error> {',
      '  { let guard = estado.mutex.lock().unwrap(); let _ = guard.leer(); }',
      '  llamada_red().await?;',
      '  Ok(())',
      '}',
    ].join('\n'));
    for (const regla of REGLAS) {
      assert.strictEqual(contar(regla, findings), 0, `${regla} no debe disparar`);
    }
  });
});
