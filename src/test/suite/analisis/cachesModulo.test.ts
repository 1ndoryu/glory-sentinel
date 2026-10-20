/* [M-S8] Las cachés de módulo se vacían al recargar el workspace: sin eso, un CSS
 * editado en el LSP seguiría dando el veredicto de antes. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { proyectoTieneModalCanonico } from '../../../utils/analisisHelpers';
import { invalidarCachesModulo, registrarCacheModulo } from '../../../utils/analisis/cachesModulo';
import { esFuenteDeIndice, indiceProyecto, invalidarIndiceProyecto } from '../../../utils/analisis/indiceProyecto';
import { leerCargoToml } from '../../../analyzers/rust/rustCargoToml';
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

/* [M-S11] Cargo.toml se lee una vez por ruta; tras invalidar, el contenido nuevo se ve. */
suite('Cargo.toml compartido (M-S11)', () => {
  test('tras invalidar, leerCargoToml devuelve el contenido editado', () => {
    const raiz = tempDir('sentinel-cargo-toml-');
    const toml = path.join(raiz, 'Cargo.toml');
    fs.writeFileSync(toml, '[package]\nname = "a"\n');
    assert.strictEqual(leerCargoToml(raiz)?.includes('name = "a"'), true);

    fs.writeFileSync(toml, '[package]\nname = "b"\n');
    invalidarCachesModulo();
    assert.strictEqual(leerCargoToml(raiz)?.includes('name = "b"'), true);
  });

  test('sin Cargo.toml, leerCargoToml devuelve null', () => {
    assert.strictEqual(leerCargoToml(tempDir('sentinel-cargo-toml-vacio-')), null);
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
