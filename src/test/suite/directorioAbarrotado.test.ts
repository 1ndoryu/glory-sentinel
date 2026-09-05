/*
 * [059A-S1] Tests de la regla directorio-abarrotado con el filtro
 * EXTENSIONES_CODIGO: los archivos no-codigo (Cargo.lock, README.md,
 * package.json, dotfiles) NO deben contar para la densidad del directorio.
 * Sin el filtro, la raiz del workspace "abarrotada" por manifests/locks
 * producia falsos positivos.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  invalidarCacheDirectorios,
  verificarDirectorioAbarrotado,
} from '../../analyzers/static/staticCodeRules';
import { createCoreDocument } from '../../core/types';

function crearDirTemporal(nombre: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sentinel-dir-${nombre}-`));
  return dir;
}

function crearDocumentoEn(dir: string, nombre: string): ReturnType<typeof createCoreDocument> {
  const ruta = path.join(dir, nombre);
  return createCoreDocument({
    uri: `file://${ruta}`,
    fileName: ruta,
    languageId: 'typescript',
    content: 'export const a = 1;\n',
  });
}

suite('directorioAbarrotado (filtro no-codigo)', () => {

  test('ignora Cargo.lock/README/dotfiles: no dispara si solo hay codigo real bajo el limite', () => {
    const dir = crearDirTemporal('nocodigo');
    try {
      /* 6 archivos de codigo (bajo el max de 10) + 8 de config/infra no-codigo */
      for (let i = 0; i < 6; i++) { fs.writeFileSync(path.join(dir, `mod${i}.rs`), 'fn a() {}\n'); }
      fs.writeFileSync(path.join(dir, 'Cargo.lock'), 'lock\n');
      fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\n');
      fs.writeFileSync(path.join(dir, 'package.json'), '{}\n');
      fs.writeFileSync(path.join(dir, 'README.md'), '# doc\n');
      fs.writeFileSync(path.join(dir, '.env'), 'KEY=1\n');
      fs.writeFileSync(path.join(dir, '.gitignore'), 'target/\n');
      fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT\n');
      fs.writeFileSync(path.join(dir, 'data.json'), '{}\n');

      invalidarCacheDirectorios();
      const doc = crearDocumentoEn(dir, 'mod0.rs');
      const violaciones = verificarDirectorioAbarrotado(doc);
      assert.strictEqual(violaciones.length, 0, 'no-codigo no debe contar; 6 de codigo < max 10');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('dispara cuando hay mas de 10 archivos de codigo reales', () => {
    const dir = crearDirTemporal('muchocodigo');
    try {
      for (let i = 0; i < 12; i++) { fs.writeFileSync(path.join(dir, `mod${i}.rs`), 'fn a() {}\n'); }

      invalidarCacheDirectorios();
      const doc = crearDocumentoEn(dir, 'mod0.rs');
      const violaciones = verificarDirectorioAbarrotado(doc);
      assert.strictEqual(violaciones.length, 1);
      assert.strictEqual(violaciones[0].reglaId, 'directorio-abarrotado');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('el filtro no-codigo NO oculta un directorio genuinamente abarrotado', () => {
    const dir = crearDirTemporal('mixto');
    try {
      /* 13 de codigo + ruido no-codigo: debe disparar igual */
      for (let i = 0; i < 13; i++) { fs.writeFileSync(path.join(dir, `mod${i}.rs`), 'fn a() {}\n'); }
      fs.writeFileSync(path.join(dir, 'Cargo.lock'), 'lock\n');
      fs.writeFileSync(path.join(dir, 'README.md'), '# doc\n');

      invalidarCacheDirectorios();
      const doc = crearDocumentoEn(dir, 'mod0.rs');
      const violaciones = verificarDirectorioAbarrotado(doc);
      assert.strictEqual(violaciones.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
