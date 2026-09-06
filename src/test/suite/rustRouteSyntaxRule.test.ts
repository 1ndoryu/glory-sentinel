import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analizarRust } from '../../analyzers/rustAnalyzer';
import { configurarOverridesReglas } from '../../config/ruleRegistry';
import { createCoreDocument } from '../../core/types';

function analyze(content: string, fileName = '/src/rutas.rs') {
  configurarOverridesReglas({
    'axum-ruta-sintaxis-rs': { habilitada: true, severidad: 'error' },
  });
  return analizarRust(createCoreDocument({
    uri: `file://${fileName}`,
    fileName,
    languageId: 'rust',
    content,
  }));
}

/* Workspace temporal con Cargo.lock minimo (solo paquetes que deciden). */
function workspaceConLock(matchit: string | null, axum: string | null): { dir: string; rutas: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-axum-'));
  const paquetes: string[] = [];
  if (matchit) {
    paquetes.push(`[[package]]\nname = "matchit"\nversion = "${matchit}"`);
  }
  if (axum) {
    paquetes.push(`[[package]]\nname = "axum"\nversion = "${axum}"`);
  }
  fs.writeFileSync(path.join(dir, 'Cargo.lock'), `${paquetes.join('\n\n')}\n`);
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  const rutas = path.join(src, 'rutas.rs');
  fs.writeFileSync(rutas, '// fixture\n');
  return { dir, rutas };
}

function limpiar(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

suite('axum-ruta-sintaxis-rs', () => {
  test('detecta {param} en .route() de una linea y multilinea', () => {
    const findings = analyze([
      'fn rutas() -> Router {',
      '  Router::new()',
      '    .route("/admin/users/{id}", delete(delete_user))',
      '    .route(',
      '      "/articles/{slug}",',
      '      get(get_article),',
      '    );',
      '}',
    ].join('\n'));

    assert.strictEqual(findings.filter(item => item.reglaId === 'axum-ruta-sintaxis-rs').length, 2);
  });

  test('no flaggea :param ni paths de utoipa', () => {
    const findings = analyze([
      'fn rutas() -> Router {',
      '  Router::new()',
      '    .route("/users/:id", get(get_user))',
      '}',
      '#[utoipa::path(get, path = "/api/articles/{id}")]',
      'async fn get_article() {}',
    ].join('\n'));

    assert.strictEqual(findings.filter(item => item.reglaId === 'axum-ruta-sintaxis-rs').length, 0);
  });

  test('respeta sentinel-disable-file', () => {
    const findings = analyze([
      '// sentinel-disable-file axum-ruta-sintaxis-rs',
      '.route("/admin/users/{id}", delete(delete_user))',
    ].join('\n'));

    assert.ok(!findings.some(item => item.reglaId === 'axum-ruta-sintaxis-rs'));
  });

  test('stack nuevo (matchit 0.8): {param} ok, :param se flaggea', () => {
    const { dir, rutas } = workspaceConLock('0.8.4', '0.8.9');
    try {
      const ok = analyze([
        'fn rutas() -> Router {',
        '  Router::new()',
        '    .route("/users/{id}", get(get_user))',
        '}',
      ].join('\n'), rutas);
      assert.strictEqual(ok.filter(item => item.reglaId === 'axum-ruta-sintaxis-rs').length, 0);

      const mal = analyze([
        'fn rutas() -> Router {',
        '  Router::new()',
        '    .route("/users/:id", get(get_user))',
        '}',
      ].join('\n'), rutas);
      assert.strictEqual(mal.filter(item => item.reglaId === 'axum-ruta-sintaxis-rs').length, 1);
    } finally {
      limpiar(dir);
    }
  });

  test('stack antiguo (matchit 0.7): {param} se flaggea, :param ok', () => {
    const { dir, rutas } = workspaceConLock('0.7.3', '0.7.9');
    try {
      const mal = analyze([
        'fn rutas() -> Router {',
        '  Router::new()',
        '    .route("/users/{id}", get(get_user))',
        '}',
      ].join('\n'), rutas);
      assert.strictEqual(mal.filter(item => item.reglaId === 'axum-ruta-sintaxis-rs').length, 1);

      const ok = analyze([
        'fn rutas() -> Router {',
        '  Router::new()',
        '    .route("/users/:id", get(get_user))',
        '}',
      ].join('\n'), rutas);
      assert.strictEqual(ok.filter(item => item.reglaId === 'axum-ruta-sintaxis-rs').length, 0);
    } finally {
      limpiar(dir);
    }
  });

  test('sin evidencia del stack: legacy (flaggea {param})', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-axum-'));
    try {
      const rutas = path.join(dir, 'rutas.rs');
      fs.writeFileSync(rutas, '// fixture\n');
      const findings = analyze('.route("/users/{id}", get(get_user))', rutas);
      assert.strictEqual(findings.filter(item => item.reglaId === 'axum-ruta-sintaxis-rs').length, 1);
    } finally {
      limpiar(dir);
    }
  });
});
