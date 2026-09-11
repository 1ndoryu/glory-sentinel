/*
 * Test runner principal.
 * Configura Mocha y ejecuta los tests de la suite.
 */

import * as path from 'path';
import Mocha from 'mocha';
import { globSync } from 'glob';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    /* [039A-1] 60s alineado con .mocharc.json: los tests de fixtures reales
     * (git init/commit + spawn del CLI) tardan 2-10s y con 10s el límite de
     * mocha quedaba por debajo del timeout de 60s que el propio test usa para
     * su spawnSync. */
    timeout: 60000,
  });

  const testsRoot = path.resolve(__dirname, '.');

  return new Promise((resolve, reject) => {
    try {
      const files = globSync('**/**.test.js', { cwd: testsRoot });
      files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

      mocha.run(failures => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
