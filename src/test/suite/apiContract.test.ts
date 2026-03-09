/*
 * Tests para las reglas de contrato API (Sprint 10).
 * Cubre: apiContractIndexer y apiContractRules
 * (api-response-mismatch, acceso-api-sin-fallback).
 */

import * as assert from 'assert';
import { verificarApiResponseMismatch, verificarAccesoApiSinFallback } from '../../analyzers/glory/apiContractRules';

/* ============== acceso-api-sin-fallback ============== */

suite('acceso-api-sin-fallback', () => {

  test('detecta setState(data.campo) sin fallback en estado array', () => {
    const lineas = [
      'const [reservas, setReservas] = useState<Reserva[]>([]);',
      'const data = await fetchAdmin("reservas");',
      'if (data) setReservas(data.reservas)',
    ];
    const v = verificarAccesoApiSinFallback(lineas);
    assert.ok(v.length > 0, 'Debe detectar setter sin fallback');
    assert.strictEqual(v[0].reglaId, 'acceso-api-sin-fallback');
  });

  test('no reporta si tiene fallback ?? []', () => {
    const lineas = [
      'const [reservas, setReservas] = useState<Reserva[]>([]);',
      'const data = await fetchAdmin("reservas");',
      'if (data) setReservas(data.reservas ?? [])',
    ];
    const v = verificarAccesoApiSinFallback(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con ?? fallback');
  });

  test('no reporta si estado no es array (null/object)', () => {
    const lineas = [
      'const [config, setConfig] = useState<Config | null>(null);',
      'const data = await fetchAdmin("configuracion");',
      'if (data) setConfig(data.configuracion)',
    ];
    const v = verificarAccesoApiSinFallback(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar para estados no-array');
  });

  test('detecta multiples setters sin fallback', () => {
    const lineas = [
      'const [vehiculos, setVehiculos] = useState<V[]>([]);',
      'const [clientes, setClientes] = useState<C[]>([]);',
      '',
      'if (data) setVehiculos(data.vehiculos)',
      'if (data) setClientes(data.clientes)',
    ];
    const v = verificarAccesoApiSinFallback(lineas);
    assert.strictEqual(v.length, 2, 'Debe detectar ambos setters');
  });

  test('no reporta con optional chaining y fallback', () => {
    const lineas = [
      'const [items, setItems] = useState<I[]>([]);',
      'if (data) setItems(data?.items ?? [])',
    ];
    const v = verificarAccesoApiSinFallback(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con ?. y ?? juntos');
  });

  test('no reporta comentarios', () => {
    const lineas = [
      'const [items, setItems] = useState<I[]>([]);',
      '// if (data) setItems(data.items)',
    ];
    const v = verificarAccesoApiSinFallback(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar lineas comentadas');
  });

  test('respeta sentinel-disable-next-line', () => {
    const lineas = [
      'const [items, setItems] = useState<I[]>([]);',
      '// sentinel-disable-next-line acceso-api-sin-fallback',
      'if (data) setItems(data.items)',
    ];
    const v = verificarAccesoApiSinFallback(lineas);
    assert.strictEqual(v.length, 0, 'Debe respetar sentinel-disable');
  });

  test('detecta setter con optional chaining pero sin ?? fallback', () => {
    const lineas = [
      'const [eventos, setEventos] = useState<E[]>([]);',
      'if (data) setEventos(data?.eventos)',
    ];
    const v = verificarAccesoApiSinFallback(lineas);
    assert.ok(v.length > 0, 'Debe detectar ?. sin ?? (aun puede ser undefined)');
  });
});

/* ============== api-response-mismatch ============== */

/*
 * Las pruebas de api-response-mismatch requieren que el indice de contratos
 * este cargado. Como en tests unitarios no tenemos el filesystem real,
 * probamos los patrones de regex de forma aislada.
 */
suite('api-response-mismatch — regex patterns', () => {

  test('detecta cuando el indice NO esta cargado (safe — no crash)', () => {
    const lineas = [
      'const data = await fetchAdmin<{ success: boolean; actividad: Evento[] }>("actividad");',
    ];
    /* Sin indice, no debe crashear ni reportar */
    const v = verificarApiResponseMismatch(lineas);
    assert.strictEqual(v.length, 0, 'Sin indice no debe reportar nada');
  });

  test('no crashea con lineas vacias', () => {
    const v = verificarApiResponseMismatch(['', '', '']);
    assert.strictEqual(v.length, 0);
  });

  test('no reporta comentarios', () => {
    const lineas = [
      '// const data = await fetchAdmin<{ success: boolean; campo: T }>("ruta");',
    ];
    const v = verificarApiResponseMismatch(lineas);
    assert.strictEqual(v.length, 0);
  });
});
