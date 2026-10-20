/* [M-S8] Las cachés de módulo se vacían al recargar el workspace: sin eso, un CSS
 * editado en el LSP seguiría dando el veredicto de antes. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { proyectoTieneModalCanonico } from '../../../utils/analisisHelpers';
import { invalidarCachesModulo, registrarCacheModulo } from '../../../utils/analisis/cachesModulo';
import { esFuenteDeIndice, indiceProyecto, invalidarIndiceProyecto } from '../../../utils/analisis/indiceProyecto';
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

/* [M-S9] El índice no se refresca solo: tras guardar un estilo, la clase nueva debe verse. */
suite('índice del LSP tras guardar (M-S9)', () => {
  test('esFuenteDeIndice acepta fuentes y estilos, no el resto', () => {
    assert.strictEqual(esFuenteDeIndice('/repo/src/Panel.tsx'), true);
    assert.strictEqual(esFuenteDeIndice('/repo/src/estilos.css'), true);
    assert.strictEqual(esFuenteDeIndice('/repo/README.md'), false);
    assert.strictEqual(esFuenteDeIndice('/repo/config.json'), false);
  });

  test('tras invalidarIndiceProyecto, una clase CSS guardada aparece en el índice', () => {
    const raiz = tempDir('sentinel-indice-save-');
    const css = path.join(raiz, 'estilos.css');
    fs.writeFileSync(css, '.viejo { color: red; }');
    assert.strictEqual(indiceProyecto([raiz]).cuerposCss.has('nuevo'), false);

    fs.writeFileSync(css, '.nuevo { color: blue; }');
    invalidarIndiceProyecto();
    assert.strictEqual(indiceProyecto([raiz]).cuerposCss.has('nuevo'), true);
  });
});
