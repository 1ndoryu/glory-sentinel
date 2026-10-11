/*
 * Interceptor de modulos para tests unitarios sin VS Code.
 * Redirije la resolucion de 'vscode' al mock local, permitiendo
 * que cualquier modulo que haga `require('vscode')` reciba el mock.
 *
 * Se carga via --require en mocha antes de ejecutar los tests.
 * Debe ser el PRIMER archivo cargado para que el interceptor
 * este activo antes de que cualquier modulo de la extension se importe.
 */

import * as path from 'path';
import * as os from 'os';

/* [10AA-2 F11.2] Los tests no escriben el registro real de C:\tmp. */
process.env.GLORY_GUARD_LOG_DIR ??= path.join(os.tmpdir(), 'glory-guard-log-tests');

/* Acceso al modulo interno de Node.js para interceptar resolucion */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module') as {
  _resolveFilename: (request: string, ...args: unknown[]) => string;
};

/* Ruta absoluta al mock compilado */
const vscodeMockPath = path.resolve(__dirname, 'vscodeMock.js');

/* Guardamos el metodo original para delegar cuando no es 'vscode' */
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function interceptarResolucion(
  request: string,
  ...args: unknown[]
): string {
  if (request === 'vscode') {
    return vscodeMockPath;
  }
  return originalResolveFilename.call(this, request, ...args) as string;
};
