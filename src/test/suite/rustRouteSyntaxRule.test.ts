import * as assert from 'assert';
import { analizarRust } from '../../analyzers/rustAnalyzer';
import { configurarOverridesReglas } from '../../config/ruleRegistry';
import { createCoreDocument } from '../../core/types';

function analyze(content: string) {
  configurarOverridesReglas({
    'axum-ruta-sintaxis-rs': { habilitada: true, severidad: 'error' },
  });
  return analizarRust(createCoreDocument({
    uri: 'file:///src/rutas.rs',
    fileName: '/src/rutas.rs',
    languageId: 'rust',
    content,
  }));
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
});
