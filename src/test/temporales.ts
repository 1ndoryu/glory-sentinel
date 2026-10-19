/*
 * Directorios temporales de los tests. Todos se registran aqui y se borran al
 * terminar la ejecucion completa de mocha, para que ninguna suite deje restos en
 * el tmp del sistema. Se borra al final y no tras cada test: algunas suites crean
 * su fixture en `suiteSetup` y lo usan en varios tests.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const temporales: string[] = [];

/* Crea un directorio temporal con el prefijo dado y lo registra para borrarlo al final. */
export function tempDir(prefijo: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
    temporales.push(dir);
    return dir;
}

export function limpiarTemporales(): void {
    for (const dir of temporales.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/* Hook raiz: corre una vez al terminar toda la ejecucion de mocha. Se registra al cargar el modulo. */
suiteTeardown(limpiarTemporales);
