import * as path from 'path';

/* Extensiones equivalentes: `.mjs`/`.cjs` son JavaScript y `.mts`/`.cts` son TypeScript.
 * [por que 17AA-2] Sin esto un `.mjs` no casaba con ninguna regla —`aplicaA` lista `.js`—
 * y el documento se quedaba en `plaintext`, asi que ni `limite-lineas` (que ya da techo 300
 * a los `.mjs`) lo veia. La normalizacion vive aqui, en un solo sitio, para que valga en
 * todas las listas de extensiones del analizador sin tocarlas una a una. */
const EQUIVALENTES: Record<string, string> = {
  '.mjs': '.js',
  '.cjs': '.js',
  '.mts': '.ts',
  '.cts': '.ts',
};

/** Extension efectiva de un archivo o de una extension suelta (`.mjs` -> `.js`). */
export function extensionCanonica(archivoOExtension: string): string {
  const ext = (archivoOExtension.startsWith('.')
    ? archivoOExtension
    : path.extname(archivoOExtension)).toLowerCase();
  return EQUIVALENTES[ext] ?? ext;
}

export function languageIdForFile(filePath: string): string {
  switch (extensionCanonica(filePath)) {
    case '.php': return 'php';
    case '.tsx': return 'typescriptreact';
    case '.jsx': return 'javascriptreact';
    case '.ts': return 'typescript';
    case '.js': return 'javascript';
    case '.rs': return 'rust';
    case '.css': return 'css';
    case '.scss': return 'scss';
    case '.less': return 'less';
    default: return 'plaintext';
  }
}
