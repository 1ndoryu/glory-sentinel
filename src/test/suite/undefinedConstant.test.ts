/*
 * Tests para la regla undefined-class-constant.
 * Inyecta un indice de constantes mock para validar deteccion
 * sin depender del filesystem.
 */

import * as assert from 'assert';
import { verificarUndefinedClassConstant } from '../../analyzers/glory/gloryConstantRules';
import { setearIndiceParaTests } from '../../analyzers/glory/phpConstantIndexer';

/* Configurar indice mock antes de cada suite */
function configurarIndiceMock(): void {
  const mapa = new Map<string, { constantes: Set<string>; extends: string | null }>();

  mapa.set('SamplesCols', {
    constantes: new Set(['TABLA', 'ID', 'CREADOR_ID', 'TITULO', 'ESTADO', 'TIPO', 'METADATA', 'TODAS']),
    extends: null,
  });
  mapa.set('SamplesEnums', {
    constantes: new Set(['ESTADO_PROCESANDO', 'ESTADO_ACTIVO', 'ESTADO_INACTIVO', 'TIPO_LOOP', 'TIPO_ONESHOT', 'TODOS_ESTADO', 'TODOS_TIPO']),
    extends: null,
  });
  mapa.set('LikesCols', {
    constantes: new Set(['TABLA', 'ID', 'USUARIO_ID', 'TIPO', 'REFERENCIA_ID']),
    extends: null,
  });
  mapa.set('BaseRepository', {
    constantes: new Set(['POR_PAGINA']),
    extends: null,
  });
  mapa.set('SamplesRepository', {
    constantes: new Set([]),
    extends: 'BaseRepository',
  });

  setearIndiceParaTests(mapa);
}

suite('undefined-class-constant', () => {

  setup(() => {
    configurarIndiceMock();
  });

  /* --- self:: con constante inexistente --- */
  test('detecta self::CONSTANTE_INEXISTENTE', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples\\Database\\Repositories;',
      '',
      'use App\\Config\\Schema\\_generated\\SamplesCols;',
      '',
      'class SamplesRepository extends BaseRepository',
      '{',
      '  public static function ejemplo(): string {',
      '    return self::CARPETA_DEFAULT;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.ok(v.length > 0, 'Debe detectar self::CARPETA_DEFAULT inexistente');
    assert.strictEqual(v[0].reglaId, 'undefined-class-constant');
    assert.ok(v[0].mensaje.includes('CARPETA_DEFAULT'));
  });

  /* --- self:: con constante que existe en padre --- */
  test('no reporta self::CONSTANTE heredada del padre', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples\\Database\\Repositories;',
      '',
      'class SamplesRepository extends BaseRepository',
      '{',
      '  public static function ejemplo(): int {',
      '    return self::POR_PAGINA;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.strictEqual(v.length, 0, 'POR_PAGINA existe en BaseRepository (padre)');
  });

  /* --- self:: con constante local --- */
  test('no reporta self::CONSTANTE definida localmente', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples\\Database\\Repositories;',
      '',
      'class MiClase',
      '{',
      '  const MI_CONSTANTE = "valor";',
      '',
      '  public function test(): string {',
      '    return self::MI_CONSTANTE;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.strictEqual(v.length, 0, 'MI_CONSTANTE existe en el mismo archivo');
  });

  /* --- Clase importada con constante existente --- */
  test('no reporta ClaseImportada::CONSTANTE_EXISTENTE', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples\\Services;',
      '',
      'use App\\Config\\Schema\\_generated\\SamplesCols;',
      'use App\\Config\\Schema\\_generated\\SamplesEnums;',
      '',
      'class MiServicio',
      '{',
      '  public function test(): string {',
      '    $tabla = SamplesCols::TABLA;',
      '    $estado = SamplesEnums::ESTADO_ACTIVO;',
      '    return $tabla . $estado;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.strictEqual(v.length, 0, 'TABLA y ESTADO_ACTIVO existen en el schema');
  });

  /* --- Clase importada con constante inexistente --- */
  test('detecta ClaseImportada::CONSTANTE_INEXISTENTE', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples\\Services;',
      '',
      'use App\\Config\\Schema\\_generated\\SamplesCols;',
      '',
      'class MiServicio',
      '{',
      '  public function test(): string {',
      '    return SamplesCols::NOMBRE_FALSO;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.ok(v.length > 0, 'NOMBRE_FALSO no existe en SamplesCols');
    assert.ok(v[0].mensaje.includes('NOMBRE_FALSO'));
    assert.ok(v[0].mensaje.includes('SamplesCols'));
  });

  /* --- parent:: con constante existente en padre --- */
  test('no reporta parent::CONSTANTE existente', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples\\Database\\Repositories;',
      '',
      'class SamplesRepository extends BaseRepository',
      '{',
      '  public function test(): int {',
      '    return parent::POR_PAGINA;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.strictEqual(v.length, 0, 'POR_PAGINA existe en BaseRepository');
  });

  /* --- parent:: con constante inexistente --- */
  test('detecta parent::CONSTANTE inexistente', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples\\Database\\Repositories;',
      '',
      'class SamplesRepository extends BaseRepository',
      '{',
      '  public function test(): string {',
      '    return parent::NO_EXISTE;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.ok(v.length > 0, 'NO_EXISTE no existe en BaseRepository');
  });

  /* --- static:: funciona igual que self:: --- */
  test('detecta static::CONSTANTE_INEXISTENTE', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples\\Database\\Repositories;',
      '',
      'class SamplesRepository extends BaseRepository',
      '{',
      '  public static function test(): string {',
      '    return static::COSA_RARA;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.ok(v.length > 0, 'COSA_RARA no existe');
  });

  /* --- Ignora ::class (pseudo-constante PHP) --- */
  test('ignora ::class pseudo-constante', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples;',
      '',
      'use App\\Config\\Schema\\_generated\\SamplesCols;',
      '',
      'class Test',
      '{',
      '  public function test(): string {',
      '    return SamplesCols::class;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.strictEqual(v.length, 0, '::class es pseudo-constante, no reportar');
  });

  /* --- Ignora clases externas (WP, PHP builtins) --- */
  test('ignora clases externas no indexadas', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples;',
      '',
      'class Test',
      '{',
      '  public function test(): int {',
      '    return PDO::FETCH_ASSOC;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.strictEqual(v.length, 0, 'PDO es clase externa, skip');
  });

  /* --- Ignora comentarios --- */
  test('ignora referencias en comentarios', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples;',
      '',
      'use App\\Config\\Schema\\_generated\\SamplesCols;',
      '',
      'class Test',
      '{',
      '  // self::CONSTANTE_INEXISTENTE_EN_COMMENT',
      '  /* SamplesCols::FAKE_CONST */',
      '  public function test(): void {}',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.strictEqual(v.length, 0, 'Comentarios deben ignorarse');
  });

  /* --- Ignora clases no encontradas en el indice (no importadas desde proyecto) --- */
  test('ignora clases desconocidas no indexadas', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples;',
      '',
      'use Vendor\\Externo\\AlgunaClase;',
      '',
      'class Test',
      '{',
      '  public function test(): string {',
      '    return AlgunaClase::ALGO;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.strictEqual(v.length, 0, 'Clases no indexadas se ignoran silenciosamente');
  });

  /* --- Multiples violaciones en un archivo --- */
  test('detecta multiples constantes indefinidas', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples;',
      '',
      'use App\\Config\\Schema\\_generated\\SamplesCols;',
      'use App\\Config\\Schema\\_generated\\SamplesEnums;',
      '',
      'class Test',
      '{',
      '  public function test(): void {',
      '    $a = SamplesCols::COLUMNA_FALSA;',
      '    $b = SamplesEnums::ESTADO_BORRADOR;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.strictEqual(v.length, 2, 'Debe detectar ambas constantes inexistentes');
  });

  /* --- sentinel-disable-next-line funciona --- */
  test('respeta sentinel-disable-next-line', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples;',
      '',
      'use App\\Config\\Schema\\_generated\\SamplesCols;',
      '',
      'class Test',
      '{',
      '  public function test(): string {',
      '    // sentinel-disable-next-line undefined-class-constant',
      '    return SamplesCols::NO_EXISTE;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.strictEqual(v.length, 0, 'sentinel-disable debe suprimir la violacion');
  });

  /* --- Caso real del bug reportado: CARPETA_DEFAULT --- */
  test('caso real: detecta SamplesRepository::CARPETA_DEFAULT', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples\\Database\\Repositories;',
      '',
      'use App\\Config\\Schema\\_generated\\SamplesCols;',
      '',
      'class SamplesRepository extends BaseRepository',
      '{',
      '  public static function carpetas(int $userId): array {',
      '    $carpetaClause = " AND COALESCE(s." . SamplesCols::METADATA',
      '         . " = " . self::CARPETA_DEFAULT;',
      '    return [];',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.ok(v.length > 0, 'CARPETA_DEFAULT no existe en SamplesRepository ni en BaseRepository');
    assert.ok(v[0].mensaje.includes('CARPETA_DEFAULT'));
  });

  /* --- Constante TODAS en archivo *Cols funciona --- */
  test('no reporta SamplesCols::TODAS (constante existente)', () => {
    const lineas = [
      '<?php',
      'namespace App\\Kamples;',
      '',
      'use App\\Config\\Schema\\_generated\\SamplesCols;',
      '',
      'class Test',
      '{',
      '  public function cols(): array {',
      '    return SamplesCols::TODAS;',
      '  }',
      '}',
    ];
    const v = verificarUndefinedClassConstant(lineas);
    assert.strictEqual(v.length, 0, 'TODAS existe en SamplesCols');
  });
});
