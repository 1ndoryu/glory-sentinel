import * as assert from 'assert';
import { instalarCanal, logError, logInfo, logWarn } from '../../../utils/logger';

/* [T4] El logger no depende de vscode: con un canal inyectado escribe ahí; sin
 * canal (CLI/LSP en Node) escribe en stderr, nunca en stdout. */
suite('logger sin vscode [T4]', () => {
  const errorOriginal = console.error;

  teardown(() => {
    instalarCanal(null);
    console.error = errorOriginal;
  });

  test('escribe en el canal inyectado con su nivel', () => {
    const lineas: string[] = [];
    instalarCanal({ appendLine: linea => lineas.push(linea) });

    logInfo('hola');
    logWarn('cuidado');

    assert.strictEqual(lineas.length, 2);
    assert.match(lineas[0], /\[INFO\] hola$/);
    assert.match(lineas[1], /\[WARN\] cuidado$/);
  });

  test('un error con objeto escribe el mensaje y el detalle', () => {
    const lineas: string[] = [];
    instalarCanal({ appendLine: linea => lineas.push(linea) });

    logError('fallo', new Error('detalle'));

    assert.strictEqual(lineas.length, 2);
    assert.match(lineas[0], /\[ERROR\] fallo$/);
    assert.match(lineas[1], /\[ERROR\] detalle/);
  });

  test('sin canal escribe en stderr y no toca stdout', () => {
    const capturadas: string[] = [];
    console.error = (...args: unknown[]) => { capturadas.push(args.join(' ')); };

    logInfo('sin canal');

    assert.strictEqual(capturadas.length, 1);
    assert.match(capturadas[0], /\[INFO\] sin canal$/);
  });
});
