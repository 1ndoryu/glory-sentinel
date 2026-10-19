// Compila el adaptador de Zed a WebAssembly y lo deja en integrations/zed/extension.wasm.
// El binario no se versiona: se genera aquí. Requiere cargo y el target wasm32-wasip2.
import { spawnSync } from 'child_process';
import { copyFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const RAIZ = fileURLToPath(new URL('../integrations/zed/', import.meta.url));
const COMPILADO = join(RAIZ, 'target', 'wasm32-wasip2', 'release', 'glory_sentinel_adapter.wasm');

const cargo = spawnSync(
  'cargo',
  ['build', '--manifest-path', join(RAIZ, 'Cargo.toml'), '--target', 'wasm32-wasip2', '--release'],
  { stdio: 'inherit' },
);
// Sin salida limpia no hay artefacto que copiar: se corta con el mismo código de error.
if (cargo.status !== 0) process.exit(cargo.status ?? 1);

copyFileSync(COMPILADO, join(RAIZ, 'extension.wasm'));
console.log('integrations/zed/extension.wasm generado');
