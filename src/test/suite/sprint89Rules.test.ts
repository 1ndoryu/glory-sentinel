/*
 * Tests para las reglas de Sprint 8 (PHP) y Sprint 9 (TS).
 * Importa directamente las funciones de deteccion (el mock de vscode
 * esta registrado via .mocharc.json -> registerMocks.js).
 */

import * as assert from 'assert';

/* Sprint 8: PHP rules */
import { verificarLockSinFinally } from '../../analyzers/php/phpControllerRules';
import { verificarCatchCriticoSoloLog } from '../../analyzers/php/phpControllerRules';
import { verificarToctouSelectInsert } from '../../analyzers/php/phpDataRules';
import { verificarCadenaIssetUpdate } from '../../analyzers/php/phpDataRules';
import { verificarJsonSinLimiteBd } from '../../analyzers/php/phpDataRules';
import { verificarRetornoIgnoradoRepo } from '../../analyzers/php/phpDataRules';
import { verificarMimeTypeCliente } from '../../analyzers/php/phpSecurityRules';
import { verificarJsonDecodeInseguro } from '../../analyzers/php/phpDataRules';

/* Sprint 9: TS rules */
import { verificarListenSinCleanup } from '../../analyzers/react/reactHookRules';
import { verificarStatusHttpGenerico } from '../../analyzers/react/reactErrorRules';
import { verificarHandlerSinTryCatch } from '../../analyzers/react/reactErrorRules';
import { verificarColaSinLimite } from '../../analyzers/react/reactComponentRules';
import { verificarObjetoMutableExportado } from '../../analyzers/react/reactComponentRules';

/* ============================= Sprint 8 ============================= */

suite('Sprint 8 — PHP Rules', () => {

  /* --- lock-sin-finally --- */
  test('lock-sin-finally: detecta flock sin finally/fclose', () => {
    const lineas = [
      '<?php',
      'function procesar() {',
      '  $fp = fopen("lock.txt", "r");',
      '  flock($fp, LOCK_EX);',
      '  doWork();',
      '  flock($fp, LOCK_UN);',
      '}',
    ];
    const v = verificarLockSinFinally(lineas);
    assert.ok(v.length > 0, 'Debe detectar flock sin finally');
    assert.strictEqual(v[0].reglaId, 'lock-sin-finally');
  });

  test('lock-sin-finally: no reporta si hay finally con fclose', () => {
    const lineas = [
      '<?php',
      'function procesar() {',
      '  $fp = fopen("lock.txt", "r");',
      '  flock($fp, LOCK_EX);',
      '  try {',
      '    doWork();',
      '  } finally {',
      '    fclose($fp);',
      '  }',
      '}',
    ];
    const v = verificarLockSinFinally(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con finally + fclose');
  });

  /* --- catch-critico-solo-log --- */
  test('catch-critico-solo-log: detecta catch con solo error_log en metodo critico', () => {
    const lineas = [
      '<?php',
      'class Pagos {',
      '  public function registrarPago() {',
      '    try {',
      '      $this->pg->insertar($datos);',
      '    } catch (\\Throwable $e) {',
      '      error_log($e->getMessage());',
      '    }',
      '  }',
      '}',
    ];
    const v = verificarCatchCriticoSoloLog(lineas);
    assert.ok(v.length > 0, 'Debe detectar catch critico con solo error_log');
    assert.strictEqual(v[0].reglaId, 'catch-critico-solo-log');
  });

  test('catch-critico-solo-log: no reporta si relanza la excepcion', () => {
    const lineas = [
      '<?php',
      'class Pagos {',
      '  public function registrarPago() {',
      '    try {',
      '      $this->pg->insertar($datos);',
      '    }',
      '    catch (\\Throwable $e) {',
      '      error_log($e->getMessage());',
      '      throw $e;',
      '    }',
      '  }',
      '}',
    ];
    const v = verificarCatchCriticoSoloLog(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar si relanza la excepcion');
  });

  /* --- toctou-select-insert --- */
  test('toctou-select-insert: detecta SELECT MAX seguido de INSERT sin transaccion', () => {
    const lineas = [
      '<?php',
      'function crearOrden() {',
      '  $max = $wpdb->get_var("SELECT MAX(orden) FROM wp_items");',
      '  $nuevoOrden = $max + 1;',
      '  $wpdb->query("INSERT INTO wp_items (orden) VALUES ($nuevoOrden)");',
      '}',
    ];
    const v = verificarToctouSelectInsert(lineas);
    assert.ok(v.length > 0, 'Debe detectar TOCTOU select-insert');
    assert.strictEqual(v[0].reglaId, 'toctou-select-insert');
  });

  test('toctou-select-insert: no reporta con transaccion', () => {
    const lineas = [
      '<?php',
      'function crearOrden() {',
      '  $wpdb->query("BEGIN");',
      '  $max = $wpdb->get_var("SELECT MAX(orden) FROM wp_items");',
      '  $nuevoOrden = $max + 1;',
      '  $wpdb->insert("wp_items", ["orden" => $nuevoOrden]);',
      '  $wpdb->query("COMMIT");',
      '}',
    ];
    const v = verificarToctouSelectInsert(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con transaccion');
  });

  /* --- cadena-isset-update --- */
  test('cadena-isset-update: detecta 5+ isset encadenados', () => {
    const lineas = [
      '<?php',
      'function actualizar($body) {',
      '  if (isset($body["nombre"])) {',
      '  }',
      '  if (isset($body["email"])) {',
      '  }',
      '  if (isset($body["tel"])) {',
      '  }',
      '  if (isset($body["bio"])) {',
      '  }',
      '  if (isset($body["avatar"])) {',
      '  }',
      '}',
    ];
    const v = verificarCadenaIssetUpdate(lineas);
    assert.ok(v.length > 0, 'Debe detectar cadena de 5+ isset consecutivos');
    assert.strictEqual(v[0].reglaId, 'cadena-isset-update');
  });

  /* --- json-sin-limite-bd --- */
  test('json-sin-limite-bd: detecta json_encode directo a BD sin limite', () => {
    const lineas = [
      '<?php',
      'function guardar($data) {',
      '  $json = json_encode($data);',
      '  $wpdb->insert("wp_meta", ["valor" => $json]);',
      '}',
    ];
    const v = verificarJsonSinLimiteBd(lineas);
    assert.ok(v.length > 0, 'Debe detectar json_encode sin limite a BD');
    assert.strictEqual(v[0].reglaId, 'json-sin-limite-bd');
  });

  test('json-sin-limite-bd: no reporta con check de strlen antes', () => {
    const lineas = [
      '<?php',
      'function guardar($data) {',
      '  if (strlen($json) > 65535) { throw new Exception("too big"); }',
      '  $json = json_encode($data);',
      '  $wpdb->insert("wp_meta", ["valor" => $json]);',
      '}',
    ];
    const v = verificarJsonSinLimiteBd(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con check de strlen previo');
  });

  /* --- retorno-ignorado-repo --- */
  test('retorno-ignorado-repo: detecta llamada a repo sin capturar retorno', () => {
    const lineas = [
      '<?php',
      'function procesar() {',
      '  $this->repositorio->insertar($datos);',
      '  return true;',
      '}',
    ];
    const v = verificarRetornoIgnoradoRepo(lineas);
    assert.ok(v.length > 0, 'Debe detectar retorno ignorado de repositorio');
    assert.strictEqual(v[0].reglaId, 'retorno-ignorado-repo');
  });

  test('retorno-ignorado-repo: no reporta si se captura retorno', () => {
    const lineas = [
      '<?php',
      'function procesar() {',
      '  $resultado = $this->repositorio->insertar($datos);',
      '  return $resultado;',
      '}',
    ];
    const v = verificarRetornoIgnoradoRepo(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar si se captura retorno');
  });

  /* --- mime-type-cliente --- */
  test('mime-type-cliente: detecta confianza en $_FILES type', () => {
    const lineas = [
      '<?php',
      'function subirArchivo() {',
      '  $tipo = $_FILES["archivo"]["type"];',
      '  if ($tipo === "image/png") {',
      '    move_uploaded_file(...);',
      '  }',
      '}',
    ];
    const v = verificarMimeTypeCliente(lineas);
    assert.ok(v.length > 0, 'Debe detectar confianza en MIME del cliente');
    assert.strictEqual(v[0].reglaId, 'mime-type-cliente');
  });

  test('mime-type-cliente: no reporta si usa finfo', () => {
    const lineas = [
      '<?php',
      'function subirArchivo() {',
      '  $finfo = finfo_open(FILEINFO_MIME_TYPE);',
      '  $tipo = finfo_file($finfo, $_FILES["archivo"]["tmp_name"]);',
      '  if ($tipo === "image/png") {',
      '    move_uploaded_file(...);',
      '  }',
      '}',
    ];
    const v = verificarMimeTypeCliente(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con verificacion server-side');
  });

  /* --- json-decode-inseguro (enhancement: fallback silencioso) --- */
  test('json-decode-inseguro: detecta ?? [] como fallback silencioso', () => {
    const lineas = [
      '<?php',
      'function cargar($raw) {',
      '  $datos = json_decode($raw, true) ?? [];',
      '  return $datos;',
      '}',
    ];
    const v = verificarJsonDecodeInseguro(lineas);
    assert.ok(v.length > 0, 'Debe detectar ?? [] como fallback silencioso');
    assert.ok(v[0].mensaje.includes('fallback'), 'Mensaje debe mencionar fallback');
  });

  test('json-decode-inseguro: detecta ?: [] como fallback silencioso', () => {
    const lineas = [
      '<?php',
      'function cargar($raw) {',
      '  $datos = json_decode($raw, true) ?: [];',
      '  return $datos;',
      '}',
    ];
    const v = verificarJsonDecodeInseguro(lineas);
    assert.ok(v.length > 0, 'Debe detectar ?: [] como fallback silencioso');
  });

  test('json-decode-inseguro: no reporta con json_last_error check', () => {
    const lineas = [
      '<?php',
      'function cargar($raw) {',
      '  $datos = json_decode($raw, true);',
      '  if (json_last_error() !== JSON_ERROR_NONE) {',
      '    throw new Exception("JSON invalido");',
      '  }',
      '  return $datos;',
      '}',
    ];
    const v = verificarJsonDecodeInseguro(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con json_last_error check');
  });
});

/* ============================= Sprint 9 ============================= */

suite('Sprint 9 — TypeScript Rules', () => {

  /* --- listen-sin-cleanup --- */
  test('listen-sin-cleanup: detecta listen() no almacenado en useEffect', () => {
    const lineas = [
      'import { listen } from "@tauri-apps/api/event";',
      '',
      'function MiComponente() {',
      '  useEffect(() => {',
      '    listen("evento", (e) => {',
      '      console.log(e);',
      '    });',
      '  }, []);',
      '  return <div />;',
      '}',
    ];
    const v = verificarListenSinCleanup(lineas);
    assert.ok(v.length > 0, 'Debe detectar listen sin cleanup');
    assert.strictEqual(v[0].reglaId, 'listen-sin-cleanup');
  });

  test('listen-sin-cleanup: no reporta con unlisten almacenado', () => {
    const lineas = [
      'import { listen } from "@tauri-apps/api/event";',
      '',
      'function MiComponente() {',
      '  useEffect(() => {',
      '    const unlisten = listen("evento", (e) => {',
      '      console.log(e);',
      '    });',
      '    return () => { unlisten.then(fn => fn()); };',
      '  }, []);',
      '  return <div />;',
      '}',
    ];
    const v = verificarListenSinCleanup(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con unlisten');
  });

  /* --- status-http-generico --- */
  test('status-http-generico: detecta 409 que marca exito sin body', () => {
    const lineas = [
      'if (response.status === 409) {',
      '  marcarExito();',
      '}',
    ];
    const v = verificarStatusHttpGenerico(lineas);
    assert.ok(v.length > 0, 'Debe detectar status 409 que marca exito sin body');
    assert.strictEqual(v[0].reglaId, 'status-http-generico');
  });

  test('status-http-generico: no reporta si inspecciona data', () => {
    const lineas = [
      'if (response.status === 409) {',
      '  const info = response.data;',
      '  marcarExito();',
      '}',
    ];
    const v = verificarStatusHttpGenerico(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar si inspecciona data');
  });

  /* --- handler-sin-trycatch --- */
  test('handler-sin-trycatch: detecta async callback sin try-catch en listen', () => {
    const lineas = [
      'listen("evento", async (e) => {',
      '  const resp = await fetch("/api");',
      '  setData(resp);',
      '});',
    ];
    const v = verificarHandlerSinTryCatch(lineas);
    assert.ok(v.length > 0, 'Debe detectar handler async sin try-catch');
    assert.strictEqual(v[0].reglaId, 'handler-sin-trycatch');
  });

  test('handler-sin-trycatch: no reporta con try-catch', () => {
    const lineas = [
      'listen("evento", async (e) => {',
      '  try {',
      '    const resp = await fetch("/api");',
      '    setData(resp);',
      '  } catch(err) {',
      '    console.error(err);',
      '  }',
      '});',
    ];
    const v = verificarHandlerSinTryCatch(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con try-catch');
  });

  /* --- cola-sin-limite --- */
  test('cola-sin-limite: detecta push a cola sin check de tamano', () => {
    const lineas = [
      'function agregarMensaje(msg: string) {',
      '  cola.push(msg);',
      '}',
    ];
    const v = verificarColaSinLimite(lineas);
    assert.ok(v.length > 0, 'Debe detectar push a cola sin limite');
    assert.strictEqual(v[0].reglaId, 'cola-sin-limite');
  });

  test('cola-sin-limite: no reporta con check de length', () => {
    const lineas = [
      'function agregarMensaje(msg: string) {',
      '  if (cola.length < MAX_SIZE) {',
      '    cola.push(msg);',
      '  }',
      '}',
    ];
    const v = verificarColaSinLimite(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con check de length');
  });

  /* --- objeto-mutable-exportado --- */
  test('objeto-mutable-exportado: detecta export const de objeto mutable', () => {
    const lineas = [
      'export const config = {',
      '  apiUrl: "http://localhost",',
      '  timeout: 5000,',
      '};',
    ];
    const v = verificarObjetoMutableExportado(lineas);
    assert.ok(v.length > 0, 'Debe detectar objeto mutable exportado');
    assert.strictEqual(v[0].reglaId, 'objeto-mutable-exportado');
  });

  test('objeto-mutable-exportado: no reporta con as const', () => {
    const lineas = [
      'export const config = {',
      '  apiUrl: "http://localhost",',
      '  timeout: 5000,',
      '} as const;',
    ];
    const v = verificarObjetoMutableExportado(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con as const');
  });

  test('objeto-mutable-exportado: no reporta arrays con Object.freeze', () => {
    const lineas = [
      'export const items = Object.freeze([',
      '  "uno",',
      '  "dos",',
      ']);',
    ];
    const v = verificarObjetoMutableExportado(lineas);
    assert.strictEqual(v.length, 0, 'No debe reportar con Object.freeze');
  });
});
