import * as assert from 'assert';
import { DEFAULT_INCLUDE_PATTERNS, buildCoreConfig, patronesDeInclusion, validateSentinelConfig } from '../../core/config';

suite('Portable boundary config', () => {
  test('accepts boundary arrays and maps them to core config', () => {
    const input = { portableBoundaries: { dom: ['/platform/'], services: ['/services/'] } };
    validateSentinelConfig(input);
    const config = buildCoreConfig(input);
    assert.deepStrictEqual(config.portableBoundaries, input.portableBoundaries);
  });

  test('rejects unknown portable boundary keys', () => {
    assert.throws(() => validateSentinelConfig({ portableBoundaries: { unknown: [] } }), /clave desconocida/);
  });
});

/* [17AA-4] Antes `includePatterns` reemplazaba los defaults, asi que una ficha
 * que declaraba los suyos congelaba una copia de los defaults de su fecha: al
 * ganar el default del `.mjs`, las 11 fichas con patrones propios siguieron sin
 * analizarlo. Ahora los defaults rellenan lo que falte, respetando el ambito
 * que la ficha eligio y sin meterle familias de lenguaje que no usa. */
suite('includePatterns se completa con los defaults [17AA-4]', () => {
  test('sin patrones propios, los defaults tal cual', () => {
    assert.deepStrictEqual(patronesDeInclusion(undefined), DEFAULT_INCLUDE_PATTERNS);
    assert.deepStrictEqual(patronesDeInclusion([]), DEFAULT_INCLUDE_PATTERNS);
    assert.deepStrictEqual(buildCoreConfig({}).includePatterns, DEFAULT_INCLUDE_PATTERNS);
  });

  test('una ficha global recibe el default nuevo en global', () => {
    const unidos = patronesDeInclusion(['**/*.ts', '**/*.tsx']);
    assert.ok(unidos.includes('**/*.mjs'), 'el default del .mjs tiene que llegar');
    assert.ok(unidos.includes('**/*.tsx'), 'y lo que declara la ficha se conserva');
    assert.ok(!unidos.includes('**/**/*.mjs'), 'sin doblar el comodin');
  });

  test('acotar a un subdirectorio se respeta: el default entra dentro del ambito', () => {
    const unidos = patronesDeInclusion(['frontend/**/*.ts', 'scripts/**/*.mjs']);
    assert.ok(unidos.includes('frontend/**/*.mjs'), 'el .mjs llega dentro de frontend/');
    assert.ok(unidos.includes('scripts/**/*.js'), 'y el .js dentro de scripts/');
    assert.ok(!unidos.includes('**/*.ts'), 'pero NO se abre el repo entero');
    assert.ok(!unidos.includes('**/*.css'), 'ni se mete css global');
  });

  test('un proyecto sin patrones web no recibe la familia web', () => {
    const rust = patronesDeInclusion(['**/*.rs', 'Cargo.toml', 'Cargo.lock']);
    assert.ok(!rust.some(p => /\.(ts|tsx|js|jsx|mjs|css)$/.test(p)), `no deberia haber web: ${rust.join(', ')}`);
    assert.deepStrictEqual(rust, ['**/*.rs', 'Cargo.toml', 'Cargo.lock']);
  });

  test('un proyecto web puro si recibe las extensiones web que le faltan', () => {
    const php = patronesDeInclusion(['**/*.php']);
    assert.ok(php.includes('**/*.php'), 'lo suyo se conserva');
    assert.ok(php.includes('**/*.js'), 'y la familia web se completa');
  });

  test('no duplica ni repite patrones', () => {
    const unidos = patronesDeInclusion(['**/*.ts', '**/*.mjs', '**/*.js']);
    assert.strictEqual(unidos.length, new Set(unidos).size);
    assert.strictEqual(unidos.filter(p => p === '**/*.mjs').length, 1);
  });
});

suite('Heavy budget config [07AA-10]', () => {
  test('accepts a well-formed budgets policy', () => {
    validateSentinelConfig({ budgets: { mode: 'enforce', limits: { 'cargo-check': 2 } } });
    validateSentinelConfig({ budgets: {} });
  });

  test('rejects unknown top-level budgets shapes fail-closed', () => {
    assert.throws(() => validateSentinelConfig({ budgets: 'yes' }), /'budgets' debe ser un objeto/);
    assert.throws(() => validateSentinelConfig({ budgets: { mode: 'sometimes' } }), /budgets\.mode/);
    assert.throws(() => validateSentinelConfig({ budgets: { limits: { 'cargo-chek': 2 } } }), /clase de límite desconocida/);
    assert.throws(() => validateSentinelConfig({ budgets: { limits: { 'cargo-check': 101 } } }), /límite inválido/);
    assert.throws(() => validateSentinelConfig({ budgets: { limits: { 'cargo-check': 1.5 } } }), /límite inválido/);
  });
});

/* [FP] La clave `tooling` de portableBoundaries tiene que pasar la validacion
 * fail-closed: una clave desconocida aborta el analisis entero. */
suite('portableBoundaries.tooling en la ficha [FP console-production]', () => {
  test('acepta tooling y lo lleva al core config', () => {
    const input = { portableBoundaries: { tooling: ['.freebuff', '/frontend/server/'] } };
    validateSentinelConfig(input);
    assert.deepStrictEqual(buildCoreConfig(input).portableBoundaries, input.portableBoundaries);
  });

  test('sigue rechazando claves desconocidas', () => {
    assert.throws(() => validateSentinelConfig({ portableBoundaries: { toolin: [] } }), /clave desconocida/);
  });
});
