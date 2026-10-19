/* [perfil] Detecta WordPress/Glory por marcadores y recomienda activar sus reglas sin activarlas solas. */
import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectarPerfilProyecto, recomendacionesPerfil } from '../../../core/perfil/perfilProyecto';

async function proyectoTemporal(archivos: Record<string, string>, carpetas: string[] = []): Promise<string> {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-perfil-'));
  for (const carpeta of carpetas) await fs.mkdir(path.join(raiz, carpeta), { recursive: true });
  for (const [ruta, contenido] of Object.entries(archivos)) {
    await fs.mkdir(path.dirname(path.join(raiz, ruta)), { recursive: true });
    await fs.writeFile(path.join(raiz, ruta), contenido, 'utf8');
  }
  return raiz;
}

suite('perfilProyecto', () => {
  test('detecta WordPress por wp-config.php en una subcarpeta', async () => {
    const raiz = await proyectoTemporal({ 'web/wp-config.php': '<?php' });
    const perfil = await detectarPerfilProyecto(raiz);
    assert.deepStrictEqual(perfil, { wordpress: true, glory: false });
  });

  test('detecta un tema de WordPress por la cabecera "Theme Name" de style.css', async () => {
    const raiz = await proyectoTemporal({ 'tema/style.css': '/*\nTheme Name: Demo\n*/' });
    assert.strictEqual((await detectarPerfilProyecto(raiz)).wordpress, true);
  });

  test('detecta Glory por una carpeta llamada Glory', async () => {
    const raiz = await proyectoTemporal({}, ['app/Glory']);
    assert.strictEqual((await detectarPerfilProyecto(raiz)).glory, true);
  });

  test('no detecta perfil en un proyecto ajeno y no recomienda nada', async () => {
    const raiz = await proyectoTemporal({ 'src/index.ts': 'export const a = 1;' });
    assert.deepStrictEqual(await detectarPerfilProyecto(raiz), { wordpress: false, glory: false });
    assert.deepStrictEqual(await recomendacionesPerfil(raiz), []);
  });

  test('recomienda activar las reglas WordPress sin activarlas solas', async () => {
    const raiz = await proyectoTemporal({ 'wp-config.php': '<?php' });
    const recomendaciones = await recomendacionesPerfil(raiz);
    assert.strictEqual(recomendaciones.length, 1);
    assert.match(recomendaciones[0], /Proyecto WordPress detectado/);
    assert.match(recomendaciones[0], /"habilitada": true/);
  });

  test('una config invalida no rompe la recomendacion', async () => {
    const raiz = await proyectoTemporal({ 'wp-config.php': '<?php', 'sentinel.config.json': '{ no json' });
    const recomendaciones = await recomendacionesPerfil(raiz);
    assert.strictEqual(recomendaciones.length, 1);
  });
});
