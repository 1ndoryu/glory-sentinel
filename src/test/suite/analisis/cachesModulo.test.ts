/* [M-S8] Las cachés de módulo se vacían al recargar el workspace: sin eso, un CSS
 * editado en el LSP seguiría dando el veredicto de antes. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { proyectoTieneModalCanonico } from '../../../utils/analisisHelpers';
import { invalidarCachesModulo, registrarCacheModulo } from '../../../utils/analisis/cachesModulo';
import { tempDir } from '../../temporales';

suite('cachés de módulo (M-S8)', () => {
  test('invalidarCachesModulo vacía las cachés registradas', () => {
    const cache = registrarCacheModulo(new Map<string, number>());
    cache.set('ruta', 1);
    invalidarCachesModulo();
    assert.strictEqual(cache.size, 0);
  });

  test('tras invalidar, el modal canónico se recalcula con el contenido nuevo', () => {
    const raiz = tempDir('sentinel-cache-modal-');
    const css = path.join(raiz, 'estilos.css');
    fs.writeFileSync(css, '.modalAcciones { display: flex; }');
    assert.strictEqual(proyectoTieneModalCanonico([raiz]), true);

    fs.writeFileSync(css, '.otra { color: red; }');
    invalidarCachesModulo();
    assert.strictEqual(proyectoTieneModalCanonico([raiz]), false);
  });
});
