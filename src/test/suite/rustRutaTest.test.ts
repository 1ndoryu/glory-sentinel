/*
 * [16A-8] Tests de que las reglas Rust de produccion reconocen por RUTA las
 * dos convenciones de fichero de solo-test que no llevan marcador dentro:
 *
 *   1. `tests/<x>.rs`    — tests de integracion del crate.
 *   2. `<mod>/tests.rs`  — modulo de tests partido a fichero propio.
 *
 * En las dos el `#[cfg(test)]` que las habilita vive en el fichero PADRE
 * (`#[cfg(test)] mod tests;`), asi que ni `esArchivoSoloTest` (que busca el
 * atributo interno `#![cfg(test)]`) ni `calcularRangosTest` (que busca un
 * bloque `#[cfg(test)] mod`) encontraban nada, y las reglas tomaban el fichero
 * de test por codigo de produccion.
 *
 * Caso real medido en KAMPLES el 2026-10-16: 103 de los 109 hallazgos de
 * `expect-produccion-rs` eran ficheros `tests.rs`.
 *
 * [16A-8] `tests/` y `<mod>/tests.rs` NO se tratan igual. `tests/` es decision
 * de cargo y basta la ruta; `<mod>/tests.rs` solo es test si el padre lo
 * declara bajo `#[cfg(test)]`. El nombre no prueba nada — decision 08AA-26,
 * que tiene su propio test en `sqlxSoloProduccionTest.test.ts` y sigue
 * cumpliendose. Por eso la mitad de los casos de abajo son TESTIGOS: ficheros
 * `tests.rs` que NO deben excluirse.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analizarRust } from '../../analyzers/rustAnalyzer';
import { configurarOverridesReglas } from '../../config/ruleRegistry';
import { createCoreDocument } from '../../core/types';
import { olvidarCacheRutasTest } from '../../analyzers/rustTestScope';

/* Codigo con un `.expect(..)`, un `.unwrap()` y un `panic!` — una infraccion de
 * cada regla que depende del alcance de test. */
const CODIGO_CON_PANICOS = [
  'use super::*;',
  '',
  'fn cargar() -> Result<String, Error> {',
  '  let v = std::fs::read_to_string("x").unwrap();',
  '  let w = std::fs::read_to_string("y").expect("leer y");',
  '  Ok(v + &w)',
  '}',
  '',
  'fn imposible() {',
  '  panic!("no deberia llegar");',
  '}',
].join('\n');

function analizar(fileName: string, content: string) {
  configurarOverridesReglas({
    'expect-produccion-rs': { habilitada: true, severidad: 'error' },
    'unwrap-produccion-rs': { habilitada: true, severidad: 'error' },
    'panic-produccion-rs': { habilitada: true, severidad: 'error' },
  });
  return analizarRust(createCoreDocument({
    uri: `file://${fileName}`,
    fileName,
    languageId: 'rust',
    content,
  }));
}

function contar(reglaId: string, findings: ReturnType<typeof analizar>): number {
  return findings.filter(item => item.reglaId === reglaId).length;
}

function totalDePanicos(fileName: string): number {
  const f = analizar(fileName, CODIGO_CON_PANICOS);
  return contar('expect-produccion-rs', f)
    + contar('unwrap-produccion-rs', f)
    + contar('panic-produccion-rs', f);
}

/* Monta un directorio real con un padre y un hijo `tests.rs`, porque la
 * decision depende de lo que diga el padre en disco. Devuelve la ruta del
 * hijo, que es lo que se le pasa al analizador. */
const directorios: string[] = [];

function fixture(padre: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-ruta-test-'));
  directorios.push(dir);
  fs.writeFileSync(path.join(dir, 'mod.rs'), padre, 'utf8');
  const hijo = path.join(dir, 'tests.rs');
  fs.writeFileSync(hijo, '', 'utf8');
  olvidarCacheRutasTest();
  return hijo;
}

/* La forma real de KAMPLES: el modulo dueño del directorio vive FUERA, en
 * `<dirPadre>/<dir>.rs` (p. ej. `src/audio/bpm.rs` declara `src/audio/bpm/`).
 * Devuelve la ruta del hijo `<dirPadre>/<dir>/tests.rs`. */
function fixturePadreFuera(padre: string): string {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-ruta-fuera-'));
  directorios.push(raiz);
  fs.writeFileSync(path.join(raiz, 'bpm.rs'), padre, 'utf8');
  const dir = path.join(raiz, 'bpm');
  fs.mkdirSync(dir);
  const hijo = path.join(dir, 'tests.rs');
  fs.writeFileSync(hijo, '', 'utf8');
  olvidarCacheRutasTest();
  return hijo;
}

suite('reglas Rust: alcance de test por ruta (16A-8)', () => {
  teardown(() => {
    for (const dir of directorios.splice(0)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    olvidarCacheRutasTest();
  });

  test('tests/ del crate es fichero de test (lo decide cargo, basta la ruta)', () => {
    assert.strictEqual(totalDePanicos('/tests/integracion.rs'), 0);
    assert.strictEqual(totalDePanicos('C:\\proyecto\\tests\\chat_humo.rs'), 0);
  });

  test('tests.rs declarado por el padre con #[cfg(test)] mod tests;', () => {
    const hijo = fixture('#[cfg(test)]\nmod tests;\n');
    assert.strictEqual(totalDePanicos(hijo), 0);
  });

  test('tests.rs declarado por el padre con #[cfg(test)] + #[path]', () => {
    /* La forma real de KAMPLES (src/audio/bpm.rs:378). */
    const hijo = fixture('#[cfg(test)]\n#[path = "bpm/tests.rs"]\nmod tests;\n');
    assert.strictEqual(totalDePanicos(hijo), 0);
  });

  test('tests.rs declarado bajo #[cfg(test)] con OTRO nombre de modulo', () => {
    /* Solo lo ve el patron de `#[path]`: el `mod` no se llama `tests`. */
    const hijo = fixture('#[cfg(test)]\n#[path = "soporte/tests.rs"]\nmod soporte;\n');
    assert.strictEqual(totalDePanicos(hijo), 0);
  });

  test('tests.rs declarado desde FUERA del directorio (<dir>.rs)', () => {
    /* Forma real de KAMPLES (src/audio/bpm.rs:378). El modulo dueño del
     * directorio es hermano del directorio, no un fichero de dentro. */
    const hijo = fixturePadreFuera('#[cfg(test)]\n#[path = "bpm/tests.rs"]\nmod tests;\n');
    assert.strictEqual(totalDePanicos(hijo), 0);
  });

  test('tests.rs declarado desde <dir>.rs con `mod tests;` a secas', () => {
    const hijo = fixturePadreFuera('#[cfg(test)]\nmod tests;\n');
    assert.strictEqual(totalDePanicos(hijo), 0);
  });

  /* ---- Testigos: la exclusion NO puede ser por nombre ---- */

  test('testigo: un tests.rs SIN padre que lo declare sigue disparando', () => {
    const hijo = fixture('pub fn listar() {}\n');
    assert.strictEqual(totalDePanicos(hijo), 3);
  });

  test('testigo: el <dir>.rs de al lado SIN #[cfg(test)] sigue disparando', () => {
    const hijo = fixturePadreFuera('pub fn listar() {}\n');
    assert.strictEqual(totalDePanicos(hijo), 3);
  });

  test('testigo: un padre que lo declara SIN #[cfg(test)] sigue disparando', () => {
    const hijo = fixture('mod tests;\n');
    assert.strictEqual(totalDePanicos(hijo), 3);
  });

  test('testigo: sin ficheros en disco no hay evidencia, sigue disparando', () => {
    assert.strictEqual(totalDePanicos('/src/repositories/tests.rs'), 3);
  });

  test('testigo: el MISMO codigo en un fichero de produccion si dispara', () => {
    const f = analizar('/src/audio/bpm/mod.rs', CODIGO_CON_PANICOS);
    assert.strictEqual(contar('expect-produccion-rs', f), 1);
    assert.strictEqual(contar('unwrap-produccion-rs', f), 1);
    assert.strictEqual(contar('panic-produccion-rs', f), 1);
  });

  test('testigo: un nombre que CONTIENE test pero no es tests.rs sigue disparando', () => {
    assert.strictEqual(totalDePanicos('/src/audio/bpm/test_helpers.rs'), 3);
    assert.strictEqual(totalDePanicos('/src/audio/bpm/tests_utils.rs'), 3);
    assert.strictEqual(totalDePanicos('/src/audio/bpm/mis_tests.rs'), 3);
  });
});
