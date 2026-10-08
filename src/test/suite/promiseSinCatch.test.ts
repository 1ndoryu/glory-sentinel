import * as assert from 'assert';
import { verificarPromiseSinCatch } from '../../analyzers/react/reactErrorRules';

suite('Promise sin catch [08AA-26]', () => {
  test('ignora lazy() con .then en la misma linea [124A-FP3]', () => {
    const lineas = [
      'const AppAdmin = lazy(() => import("./app/app-admin").then((m) => ({ default: m.AppAdmin })));',
    ];
    assert.strictEqual(verificarPromiseSinCatch(lineas).length, 0);
  });

  test('ignora lazy() multilinea: import().then en la linea siguiente (FP App.tsx)', () => {
    const lineas = [
      'const AppAdmin = lazy(() =>',
      '  import("./app/app-admin").then((m) => ({ default: m.AppAdmin })),',
      ');',
    ];
    assert.strictEqual(verificarPromiseSinCatch(lineas).length, 0);
  });

  test('marca .then sin catch ni try ni lazy', () => {
    const lineas = ['fetchData().then((r) => setX(r));'];
    const violaciones = verificarPromiseSinCatch(lineas);
    assert.strictEqual(violaciones.length, 1);
    assert.strictEqual(violaciones[0].reglaId, 'promise-sin-catch');
  });

  test('respeta try-catch envolvente', () => {
    const lineas = ['try {', '  fetchData().then((r) => setX(r));', '} catch (e) {', '  setError(e);', '}'];
    assert.strictEqual(verificarPromiseSinCatch(lineas).length, 0);
  });

  test('respeta sentinel-disable-next-line con justificacion (catch-interno)', () => {
    const lineas = [
      '// sentinel-disable-next-line promise-sin-catch -- catch-interno: alta() captura en el hook y expone c.error',
      'void c.alta(nombre, telefono).then(() => {',
      '  setAlta({ nombre: "", telefono: "" });',
      '});',
    ];
    assert.strictEqual(verificarPromiseSinCatch(lineas).length, 0);
  });
});
