import * as assert from 'assert';
import { analizarRust } from '../../analyzers/rustAnalyzer';
import { configurarOverridesReglas } from '../../config/ruleRegistry';
import { createCoreDocument } from '../../core/types';

function analyze(content: string) {
  configurarOverridesReglas({
    'broadcast-mutex-riesgo-rs': { habilitada: true, severidad: 'error' },
  });
  return analizarRust(createCoreDocument({
    uri: 'file:///src/channel.rs',
    fileName: '/src/channel.rs',
    languageId: 'rust',
    content,
  }));
}

suite('broadcast-mutex-riesgo-rs', () => {
  test('detecta import y creación de canal broadcast', () => {
    const findings = analyze([
      'use tokio::sync::broadcast;',
      'fn channel() {',
      '  let (_tx, _rx) = broadcast::channel(16);',
      '}',
    ].join('\n'));

    assert.strictEqual(findings.filter(item => item.reglaId === 'broadcast-mutex-riesgo-rs').length, 2);
  });

  test('respeta sentinel-disable-file', () => {
    const findings = analyze([
      '// sentinel-disable-file broadcast-mutex-riesgo-rs',
      'use tokio::sync::broadcast;',
    ].join('\n'));

    assert.ok(!findings.some(item => item.reglaId === 'broadcast-mutex-riesgo-rs'));
  });
});
