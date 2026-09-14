/*
 * [149A-1] Tests del batch F1+F2 (10 reglas: 9 Rust + 1 TS).
 * Cada regla con caso minimo (dispara) y caso de no-disparo.
 * Criterio H11: los no-disparo fijan los contraejemplos de la auditoria.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analizarRust } from '../../analyzers/rustAnalyzer';
import { analizarEstatico } from '../../analyzers/staticAnalyzer';
import { configurarOverridesReglas } from '../../config/ruleRegistry';
import { configurarWorkspaceRoots } from '../../core/workspaceRoots';
import { createCoreDocument } from '../../core/types';

const REGLAS_RUST = [
  'rusqlite-bloqueante-en-async',
  'shell-modelo-sin-allowlist',
  'secreto-en-log',
  'ruta-post-sin-rate-limit',
  'path-join-sin-canonicalize',
  'sqlite-carga-N-consultas',
  'clone-bajo-lock-rs',
  'god-object-rs',
  'port-fs-duplicado-rs',
];

function analyzeRustDoc(content: string, fileName = '/src/reglas.rs') {
  configurarOverridesReglas(Object.fromEntries([
    ...REGLAS_RUST.map(id => [id, { habilitada: true }]),
    ['expect-produccion-rs', { habilitada: true }],
    ['block-en-async-rs', { habilitada: true }],
    ['lock-a-traves-await-rs', { habilitada: true }],
  ]));
  /* Sin roots por defecto: port-fs-duplicado-rs es fail-closed (cada test de
   * workspace configura y resetea sus propias roots en try/finally). */
  return analizarRust(createCoreDocument({
    uri: `file://${fileName}`,
    fileName,
    languageId: 'rust',
    content,
  }));
}

function analyzeTsDoc(content: string, fileName = '/src/ui/mensajes.ts', permitidos: string[] = []) {
  configurarOverridesReglas({
    'html-sin-origen-declarado': { habilitada: true, severidad: 'error' },
  });
  const lineas = content.split('\n');
  const documento = {
    fileName,
    lineCount: lineas.length,
    getText: () => content,
    lineAt: (line: number) => ({ text: lineas[line] ?? '' }),
    positionAt: () => ({ line: 0, character: 0 }),
  } as never;
  return analizarEstatico(documento, undefined, { htmlProductoresPermitidos: permitidos });
}

function contar(reglaId: string, findings: Array<{ reglaId: string }>): number {
  return findings.filter(item => item.reglaId === reglaId).length;
}

suite('[149A-1] archivos solo-test', () => {
  test('las reglas nuevas ignoran archivo con #![cfg(test)]', () => {
    const findings = analyzeRustDoc([
      '#![cfg(test)]',
      'use std::sync::Mutex;',
      'use rusqlite::Connection;',
      'struct F { conn: Mutex<Connection> }',
      'async fn f(s: &F) {',
      '  let g = s.conn.lock().unwrap();',
      '  g.execute_batch("SELECT 1");',
      '}',
    ].join('\n'));
    for (const regla of REGLAS_RUST) {
      assert.strictEqual(contar(regla, findings), 0, `${regla} no debe disparar en solo-test`);
    }
  });
});

suite('[149A-1] rusqlite-bloqueante-en-async', () => {
  test('dispara con Mutex<Connection> + .lock() en async (caso puerto.rs:26)', () => {
    const findings = analyzeRustDoc([
      'use std::sync::Mutex;',
      'use rusqlite::Connection;',
      'struct P { conn: Mutex<Connection> }',
      'async fn leer(p: &P) {',
      '  let db = p.conn.lock().unwrap();',
      '  db.execute_batch("SELECT 1");',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('rusqlite-bloqueante-en-async', findings), 1);
  });

  test('no dispara en funcion sincrona ni sin Mutex<Connection>', () => {
    const findings = analyzeRustDoc([
      'use std::sync::Mutex;',
      'struct C { n: Mutex<u32> }',
      'fn leer(c: &C) -> u32 {',
      '  *c.n.lock().unwrap()',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('rusqlite-bloqueante-en-async', findings), 0);
  });
});

suite('[149A-1] shell-modelo-sin-allowlist', () => {
  test('dispara con cmd + argumento variable', () => {
    const findings = analyzeRustDoc([
      'use std::process::Command;',
      'fn clonar(rama: &str) {',
      '  Command::new("cmd").arg("/C").arg(format!("git checkout {rama}")).status();',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('shell-modelo-sin-allowlist', findings), 1);
  });

  test('no dispara con binario concreto y args literales (contraejemplo git.rs:385)', () => {
    const findings = analyzeRustDoc([
      'use std::process::Command;',
      'fn estado() {',
      '  Command::new("git").arg("status").arg("--porcelain").status();',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('shell-modelo-sin-allowlist', findings), 0);
  });
});

suite('[149A-1] secreto-en-log', () => {
  test('dispara con secreto interpolado en log (caso daemon.rs:285)', () => {
    const findings = analyzeRustDoc([
      'fn vigilar(token: &str) {',
      '  eprintln!("daemon token {} activo", token);',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('secreto-en-log', findings), 1);
  });

  test('no dispara con literal sin argumentos', () => {
    const findings = analyzeRustDoc([
      'fn vigilar() {',
      '  println!("token expired");',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('secreto-en-log', findings), 0);
  });
});

suite('[149A-1] ruta-post-sin-rate-limit', () => {
  test('dispara con POST sin governor visible (caso web/mod.rs)', () => {
    const findings = analyzeRustDoc([
      'fn rutas() {',
      '  app.route("/api/x", post(crear));',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('ruta-post-sin-rate-limit', findings), 1);
  });

  test('no dispara si el fichero menciona governor', () => {
    const findings = analyzeRustDoc([
      'use tower_governor::GovernorLayer;',
      'fn rutas() {',
      '  app.route("/api/x", post(crear));',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('ruta-post-sin-rate-limit', findings), 0);
  });
});

suite('[149A-1] path-join-sin-canonicalize', () => {
  test('dispara con join sin canonicalize (caso memoria.rs:417)', () => {
    const findings = analyzeRustDoc([
      'use std::path::PathBuf;',
      'fn cargar(base: &PathBuf, nombre: &str) -> PathBuf {',
      '  base.join(nombre)',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('path-join-sin-canonicalize', findings), 1);
  });

  test('no dispara si el scope canonicaliza', () => {
    const findings = analyzeRustDoc([
      'use std::path::PathBuf;',
      'fn cargar(base: &PathBuf, nombre: &str) -> PathBuf {',
      '  let p = base.join(nombre);',
      '  let c = p.canonicalize().unwrap();',
      '  assert!(c.starts_with(base));',
      '  c',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('path-join-sin-canonicalize', findings), 0);
  });
});

suite('[149A-1] sqlite-carga-N-consultas', () => {
  test('dispara con 3 awaits secuenciales (caso conversaciones.rs)', () => {
    const findings = analyzeRustDoc([
      'async fn resumen(db: &Db) {',
      '  let a = db.conversaciones().await;',
      '  let b = db.mensajes().await;',
      '  let c = db.adjuntos().await;',
      '  let _ = (a, b, c);',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('sqlite-carga-N-consultas', findings), 1);
  });

  test('no dispara con join! ni con 2 awaits', () => {
    const findings = analyzeRustDoc([
      'async fn resumen(db: &Db) {',
      '  let (a, b, c) = tokio::join!(db.a(), db.b(), db.c());',
      '  let _ = (a, b, c);',
      '}',
      'async fn corto(db: &Db) {',
      '  let a = db.a().await;',
      '  let b = db.b().await;',
      '  let _ = (a, b);',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('sqlite-carga-N-consultas', findings), 0);
  });
});

suite('[149A-1] clone-bajo-lock-rs', () => {
  test('dispara con .clone() bajo lock (casos scheduler.rs:66, web_datos/mod.rs:98)', () => {
    const findings = analyzeRustDoc([
      'use std::sync::Mutex;',
      'fn tick(m: &Mutex<Vec<u8>>) {',
      '  let g = m.lock().unwrap();',
      '  let copia = g.clone();',
      '  let _ = copia.len();',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('clone-bajo-lock-rs', findings), 1);
  });

  test('no dispara con Arc::clone (exento por construccion)', () => {
    const findings = analyzeRustDoc([
      'use std::sync::{Arc, Mutex};',
      'fn tick(m: &Mutex<Vec<u8>>) {',
      '  let g = m.lock().unwrap();',
      '  drop(g);',
      '  let _ = Arc::clone(&m);',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('clone-bajo-lock-rs', findings), 0);
  });

  test('con await posterior no hay doble marcado en la misma linea', () => {
    const findings = analyzeRustDoc([
      'use std::sync::Mutex;',
      'async fn tick(m: &Mutex<Vec<u8>>) {',
      '  let g = m.lock().unwrap();',
      '  let copia = g.clone();',
      '  lavori().await;',
      '  let _ = copia.len();',
      '}',
      'async fn lavori() {}',
    ].join('\n'));
    const clones = findings.filter(v => v.reglaId === 'clone-bajo-lock-rs');
    const awaits = findings.filter(v => v.reglaId === 'lock-a-traves-await-rs');
    assert.strictEqual(clones.length, 1);
    assert.strictEqual(awaits.length, 1);
    assert.notStrictEqual(clones[0].linea, awaits[0].linea);
  });
});

suite('[149A-1] god-object-rs', () => {
  function cuerpoGrande(n: number): string {
    return Array.from({ length: n }, (_, i) => `pub struct Modelo${i} { pub id: u32 }`).join('\n');
  }

  test('warning >500 efectivas', () => {
    const findings = analyzeRustDoc(cuerpoGrande(600));
    const mias = findings.filter(v => v.reglaId === 'god-object-rs');
    assert.strictEqual(mias.length, 1);
    assert.strictEqual(mias[0].severidad, 'warning');
  });

  test('error >800 efectivas', () => {
    const findings = analyzeRustDoc(cuerpoGrande(900));
    const mias = findings.filter(v => v.reglaId === 'god-object-rs');
    assert.strictEqual(mias.length, 1);
    assert.strictEqual(mias[0].severidad, 'error');
  });

  test('mod.rs solo-reexport exento aunque sea largo', () => {
    const cuerpo = Array.from({ length: 600 }, (_, i) => `pub mod modulo${i};`).join('\n');
    const findings = analyzeRustDoc(cuerpo, '/src/mod.rs');
    assert.strictEqual(contar('god-object-rs', findings), 0);
  });
});

suite('[149A-1] port-fs-duplicado-rs', () => {
  test('fail-closed sin workspace roots', () => {
    const findings = analyzeRustDoc(['fn f() {', '  let x = 1;', '  let _ = x;', '}'].join('\n'));
    assert.strictEqual(contar('port-fs-duplicado-rs', findings), 0);
  });

  test('waiver diverge de exime aunque haya roots', () => {
    configurarWorkspaceRoots(['/tmp/inexistente-149a1']);
    try {
      const findings = analyzeRustDoc(
        ['// diverge de persistencia_sqlite porque el schema es distinto', 'fn f() {', '  let x = 1;', '}'].join('\n'),
        '/tmp/inexistente-149a1/a.rs',
      );
      assert.strictEqual(contar('port-fs-duplicado-rs', findings), 0);
    } finally {
      configurarWorkspaceRoots([]);
    }
  });

  test('dispara con gemelo >80% en otro crate', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portfs-149a1-'));
    try {
      const compartidas = Array.from({ length: 25 }, (_, i) => `  let v${i} = ${i};`).join('\n');
      const a = ['fn f() {', compartidas, '  let solo_a = 1;', '  let _ = solo_a;', '}'].join('\n');
      const b = ['fn f() {', compartidas, '  let solo_b = 2;', '  let _ = solo_b;', '}'].join('\n');
      fs.mkdirSync(path.join(tmp, 'crate-a'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'crate-b'), { recursive: true });
      const rutaA = path.join(tmp, 'crate-a', 'puerto.rs');
      fs.writeFileSync(path.join(tmp, 'crate-b', 'puerto.rs'), b);
      configurarWorkspaceRoots([tmp]);
      const findings = analyzeRustDoc(a, rutaA);
      assert.strictEqual(contar('port-fs-duplicado-rs', findings), 1);
    } finally {
      configurarWorkspaceRoots([]);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

suite('[149A-1] html-sin-origen-declarado (TS)', () => {
  test('dispara con productor exportado sin declarar (caso mensajesUtil.ts)', () => {
    const findings = analyzeTsDoc([
      'export function formatoMensaje(texto: string): string {',
      '  return `<div class="msg">${texto}</div>`;',
      '}',
    ].join('\n'));
    const mias = findings.filter(v => v.reglaId === 'html-sin-origen-declarado');
    assert.strictEqual(mias.length, 1);
    assert.strictEqual(mias[0].severidad, 'error');
  });

  test('no dispara si el productor esta en la allowlist (sufijo de ruta)', () => {
    const findings = analyzeTsDoc(
      [
        'export function formatoMensaje(texto: string): string {',
        '  return `<div class="msg">${texto}</div>`;',
        '}',
      ].join('\n'),
      '/repo/src/ui/mensajesUtil.ts',
      ['src/ui/mensajesUtil.ts'],
    );
    assert.strictEqual(contar('html-sin-origen-declarado', findings), 0);
  });

  test('no dispara con consumidor con allowlist sin literal HTML propio', () => {
    const findings = analyzeTsDoc([
      'export function renderizar(el: HTMLElement, html: string): void {',
      '  el.innerHTML = sanitizar(html);',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('html-sin-origen-declarado', findings), 0);
  });

  test('waiver sentinel-disable-file exime', () => {
    const findings = analyzeTsDoc([
      '/* sentinel-disable-file html-sin-origen-declarado */',
      'export function formatoMensaje(texto: string): string {',
      '  return `<div>${texto}</div>`;',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('html-sin-origen-declarado', findings), 0);
  });

  test('H11: 0 FP en self-scan (placeholders, generics, mensajes, comentarios)', () => {
    const findings = analyzeTsDoc([
      '/* [108A-1 F6] `Authorization: Bearer <token>`: el valor consume el prefijo */',
      'export function taskUsage(): string {',
      "  return 'sentinel task claim <id> --project-root <dir> [--force]';",
      '}',
      'export function exigirStages(): void {',
      "  throw new Error('check sin --dry-run requiere --stages <json> con las etapas');",
      '}',
      'export function estado(): string[] {',
      "  return ['<git-status-unavailable>'];",
      '}',
      'export const REGLAS = [',
      "  { id: 'x', nombre: 'Mutex<Connection> rusqlite con .lock() en async' },",
      '];',
      'export function mensajeBoton(): string {',
      "  return 'Usar componente <Boton> en vez de <button> nativo.';",
      '}',
      'export function mensajeBotonTpl(): string {',
      '  const n = "x";',
      '  return `Usar <Button> de ui en ${n}`;',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('html-sin-origen-declarado', findings), 0);
  });
});

suite('[149A-1] H11 harness (precision 2026-09-14)', () => {
  test('port-fs no se compara consigo mismo aunque este en disco', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portself-149a1-'));
    try {
      const contenido = [
        'use std::sync::Mutex;',
        'use rusqlite::Connection;',
        'pub struct P { pub conn: Mutex<Connection> }',
        'impl P {',
        '  pub fn abrir(ruta: &str) -> Self {',
        '    let conn = Connection::open(ruta).unwrap();',
        '    Self { conn: Mutex::new(conn) }',
        '  }',
        '}',
      ].join('\n');
      const ruta = path.join(tmp, 'persistencia.rs');
      fs.writeFileSync(ruta, contenido);
      configurarWorkspaceRoots([tmp]);
      const findings = analyzeRustDoc(contenido, ruta);
      assert.strictEqual(contar('port-fs-duplicado-rs', findings), 0);
    } finally {
      configurarWorkspaceRoots([]);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('path-join: un hallazgo por linea y literales fijos exentos', () => {
    const findings = analyzeRustDoc([
      'use std::path::PathBuf;',
      'fn f(base: &PathBuf, a: &str, b: &str) -> PathBuf {',
      '  let p = base.join(a).join(b);',
      '  let q = base.join("fijo");',
      '  let _ = q;',
      '  p',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('path-join-sin-canonicalize', findings), 1);
  });

  test('N-consultas: awaits sin persistencia no cuentan (git/sleep)', () => {
    const findings = analyzeRustDoc([
      'async fn desplegar() {',
      '  ejecutar_git("fetch").await;',
      '  ejecutar_git("pull").await;',
      '  tokio::time::sleep(d).await;',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('sqlite-carga-N-consultas', findings), 0);
  });

  test('N-consultas: cadenas multilinea sobre db si cuentan', () => {
    const findings = analyzeRustDoc([
      'async fn resumen(db: &Db) {',
      '  let a = db.conversaciones()',
      '    .await;',
      '  let b = db.mensajes()',
      '    .await;',
      '  let c = db.adjuntos()',
      '    .await;',
      '  let _ = (a, b, c);',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('sqlite-carga-N-consultas', findings), 1);
  });

  test('secreto: coma dentro del literal y metricas tokens_* no disparan', () => {
    const findings = analyzeRustDoc([
      'fn metricas(tokens_before: u32, tokens_after: u32) {',
      '  eprintln!("antes {} despues {}", tokens_before, tokens_after);',
      '  eprintln!("aviso sin token, solo coma en mensaje");',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('secreto-en-log', findings), 0);
  });

  test('rusqlite: lock dentro de spawn_blocking exento (es el fix)', () => {
    const findings = analyzeRustDoc([
      'use std::sync::Mutex;',
      'use rusqlite::Connection;',
      'struct P { conn: Mutex<Connection> }',
      'async fn leer(p: P) -> i64 {',
      '  tokio::task::spawn_blocking(move || {',
      '    let db = p.conn.lock().unwrap();',
      '    db.query_row("SELECT 1", [], |r| r.get(0)).unwrap()',
      '  }).await.unwrap()',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('rusqlite-bloqueante-en-async', findings), 0);
  });

  test('shell: funcion con modelo allowlist exime (caso jaula.rs:256)', () => {
    const findings = analyzeRustDoc([
      'use std::process::Command;',
      'const BUILTINS_CMD: &[&str] = &["git", "cargo"];',
      'fn ejecutar(argv: &[String]) -> Result<(), String> {',
      '  let bin = normalizar(&argv[0]);',
      '  if !BUILTINS_CMD.contains(&bin.as_str()) {',
      '    return Err("denegado".to_string());',
      '  }',
      '  let mut c = Command::new("cmd");',
      '  c.arg("/C").arg(&bin).args(&argv[1..]);',
      '  c.status().map(|_| ()).map_err(|e| e.to_string())',
      '}',
      'fn normalizar(s: &str) -> String { s.to_string() }',
    ].join('\n'));
    assert.strictEqual(contar('shell-modelo-sin-allowlist', findings), 0);
  });

  test('shell: sin allowlist sigue disparando (caso git.rs coolify)', () => {
    const findings = analyzeRustDoc([
      'use std::process::Command;',
      'fn clonar(rama: &str) {',
      '  Command::new("cmd").arg("/C").arg(format!("git checkout {rama}")).status();',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('shell-modelo-sin-allowlist', findings), 1);
  });

  test('path-join: join(CONSTANTE) exento pero join(variable) en la misma linea dispara', () => {
    const sinHallazgo = analyzeRustDoc([
      'use std::path::{Path, PathBuf};',
      'const CARPETA_PROYECTO: &str = "project";',
      'pub fn carpeta_proyecto_en(raiz_contenida: &Path) -> PathBuf {',
      '  raiz_contenida.join(CARPETA_PROYECTO)',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('path-join-sin-canonicalize', sinHallazgo), 0);

    const conVariable = analyzeRustDoc([
      'use std::path::{Path, PathBuf};',
      'const C: &str = "fijo";',
      'fn f(base: &Path, nombre: &str) -> PathBuf {',
      '  base.join(C).join(nombre)',
      '}',
    ].join('\n'));
    assert.strictEqual(contar('path-join-sin-canonicalize', conVariable), 1);
  });
});
