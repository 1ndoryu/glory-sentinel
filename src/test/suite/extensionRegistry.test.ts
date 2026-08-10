/* [108A-1 Fase 2] Tests del registro de extensiones (contrato del producto
 * único): una regla, un dueño; sin colisiones con el núcleo; sin extensiones
 * ejecutables no declaradas. El módulo es puro (sin I/O), por eso los tests
 * cubren la validación lógica completa. */
import * as assert from 'assert';
import { obtenerIdsReglas } from '../../config/ruleRegistry';
import {
  assertNoUndeclaredExecutables,
  ExtensionRegistration,
  validateExtensionRegistry,
} from '../../core/extensionRegistry';

const BASE: ExtensionRegistration = {
  id: 'varsense',
  owner: 'equipo-frontend',
  ruleIds: ['css-inline-ts', 'import-sin-uso-ts'],
  entrypoint: './tools/varsense/bin/varsense.mjs',
  fixtures: ['varsense/fixtures/'],
  budgets: { analyzeMs: 6000 },
  retirementCondition: 'cuando el core cubra la regla con paridad y dos consumidores',
};

suite('Registro de extensiones — una regla, un dueño (108A-1 Fase 2)', () => {
  test('registro válido: extensionIds ordenados y ruleOwners con dueño único', () => {
    const validation = validateExtensionRegistry([
      BASE,
      { id: 'glory-api', owner: 'equipo-backend', ruleIds: ['api-shape-ts'] },
    ]);
    assert.deepStrictEqual(validation.extensionIds, ['glory-api', 'varsense']);
    assert.strictEqual(validation.ruleOwners.get('css-inline-ts'), 'varsense');
    assert.strictEqual(validation.ruleOwners.get('api-shape-ts'), 'glory-api');
  });

  test('colisión de rule ID entre extensiones se rechaza', () => {
    assert.throws(
      () => validateExtensionRegistry([
        BASE,
        { id: 'otro', owner: 'equipo-b', ruleIds: ['css-inline-ts'] },
      ]),
      /colisión de rule ID: css-inline-ts/,
    );
  });

  test('colisión de rule ID con una regla del núcleo se rechaza (fuente: ruleRegistry)', () => {
    const builtin = obtenerIdsReglas();
    assert.ok(builtin.has('eval-prohibido'), 'regla builtin conocida presente en el registro');
    assert.throws(
      () => validateExtensionRegistry([{ ...BASE, ruleIds: ['eval-prohibido'] }]),
      /colisión de rule ID con el núcleo: eval-prohibido/,
    );
  });

  test('identidad duplicada se rechaza', () => {
    assert.throws(
      () => validateExtensionRegistry([BASE, BASE]),
      /identidad de extensión duplicada: varsense/,
    );
  });

  test('identidad inválida, owner ausente y ruleIds vacíos se rechazan', () => {
    assert.throws(() => validateExtensionRegistry([{ ...BASE, id: 'Con Mayúscula' }]), /identidad válida/);
    assert.throws(() => validateExtensionRegistry([{ ...BASE, owner: '  ' }]), /sin owner/);
    assert.throws(() => validateExtensionRegistry([{ ...BASE, ruleIds: [] }]), /sin rule IDs/);
  });

  test('entrypoint debe ser una ruta relativa', () => {
    assert.throws(
      () => validateExtensionRegistry([{ ...BASE, entrypoint: '/usr/bin/varsense' }]),
      /ruta relativa/,
    );
    assert.doesNotThrow(() => validateExtensionRegistry([{ ...BASE, entrypoint: './tools/varsense' }]));
  });

  test('extensiones ejecutables no declaradas se rechazan', () => {
    assert.doesNotThrow(() => assertNoUndeclaredExecutables([BASE], ['./tools/varsense/bin/varsense.mjs']));
    assert.throws(
      () => assertNoUndeclaredExecutables([BASE], ['./tools/otro/bin/otro.mjs']),
      /extensión ejecutable no declarada en el registro: \.\/tools\/otro\/bin\/otro\.mjs/,
    );
  });
});
