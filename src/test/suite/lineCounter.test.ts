/*
 * Tests unitarios para el analizador estatico.
 * Verifica que las reglas regex detectan correctamente cada patron.
 */

import * as assert from 'assert';
import { contarLineasEfectivas, obtenerLimiteArchivo } from '../../utils/lineCounter';

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

  test('obtenerLimiteArchivo - hook detectado', () => {
    const limite = obtenerLimiteArchivo('useAlumnos.ts', '/src/hooks/useAlumnos.ts');
    assert.notStrictEqual(limite, null);
    assert.strictEqual(limite?.tipo, 'hook');
    assert.strictEqual(limite?.limite, 120);
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
    assert.strictEqual(limite?.limite, 300);
  });

  test('obtenerLimiteArchivo - archivo sin limite', () => {
    const limite = obtenerLimiteArchivo('README.md', '/README.md');
    assert.strictEqual(limite, null);
  });
});
