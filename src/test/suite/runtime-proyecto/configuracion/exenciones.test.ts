/* [M-S3] Las exenciones son opt-in: sin clave no eximen nada; el perfil glory activa su conjunto. */
import * as assert from 'assert';
import { buildCoreConfig, validateSentinelConfig } from '../../../../core/runtime-proyecto/config';
import { configurarExenciones, componenteExentoPorProyecto, resolverExenciones, rutaExentaPorProyecto } from '../../../../config/exencionesProyecto';

suite('exenciones', () => {
  teardown(() => configurarExenciones(undefined));

  test('por defecto no exime ninguna ruta ni componente', () => {
    assert.strictEqual(rutaExentaPorProyecto('/repo/glory-rs/frontend/Componentes.css'), false);
    assert.strictEqual(componenteExentoPorProyecto('GloryLink'), false);
  });

  test('el perfil glory exime sus rutas y componentes', () => {
    configurarExenciones({ perfil: 'glory' });
    assert.strictEqual(rutaExentaPorProyecto('/repo/glory-rs/frontend/Componentes.css'), true);
    assert.strictEqual(rutaExentaPorProyecto('/repo/frontend/public/assets/css/home.css'), true);
    assert.strictEqual(rutaExentaPorProyecto('/repo/frontend/src/panel.css'), false);
    assert.strictEqual(componenteExentoPorProyecto('PageRenderer'), true);
    assert.strictEqual(componenteExentoPorProyecto('Panel'), false);
  });

  test('rutas y componentes propios se suman al perfil', () => {
    const resueltas = resolverExenciones({ perfil: 'glory', rutas: ['/legacy/'], componentes: ['Tarjeta'] });
    assert.ok(resueltas.rutas.includes('/legacy/'));
    assert.ok(resueltas.rutas.includes('/glory-rs/'));
    assert.ok(resueltas.componentes.includes('Tarjeta'));
    assert.ok(resueltas.componentes.includes('GloryLink'));
  });

  test('sin perfil, solo cuentan las listas propias', () => {
    configurarExenciones({ rutas: ['/legacy/'] });
    assert.strictEqual(rutaExentaPorProyecto('/repo/legacy/a.css'), true);
    assert.strictEqual(rutaExentaPorProyecto('/repo/glory-rs/a.css'), false);
  });

  test('buildCoreConfig pasa exenciones desde la subconfig v2 y v1', () => {
    const v2 = buildCoreConfig({ schemaVersion: 2, analyzers: { sentinel: { config: { exenciones: { perfil: 'glory' } } } } });
    const v1 = buildCoreConfig({ exenciones: { rutas: ['/legacy/'] } });
    assert.deepStrictEqual(v2.exenciones, { perfil: 'glory' });
    assert.deepStrictEqual(v1.exenciones, { rutas: ['/legacy/'] });
  });

  test('un perfil desconocido se rechaza con los válidos', () => {
    assert.throws(() => validateSentinelConfig({ exenciones: { perfil: 'otro' } }), /exenciones\.perfil.*glory/);
  });

  test('una clave desconocida dentro de exenciones se rechaza', () => {
    assert.throws(() => validateSentinelConfig({ exenciones: { ruta: ['/x/'] } }), /exenciones\.ruta/);
  });

  test('rutas y componentes deben ser listas de cadenas', () => {
    assert.throws(() => validateSentinelConfig({ exenciones: { rutas: '/x/' } }), /exenciones\.rutas/);
    assert.throws(() => validateSentinelConfig({ exenciones: { componentes: [1] } }), /exenciones\.componentes/);
  });
});
