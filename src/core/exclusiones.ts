/* Lista base de directorios que ningún analizador debe recorrer: dependencias, control de versiones
 * y salidas de build. Cada analizador añade sus excepciones con `exclusionesCon`, así la lista común
 * vive en un único sitio y las diferencias quedan explícitas en cada llamada. */
export const EXCLUSIONES_BASE: readonly string[] = [
  'node_modules',
  'vendor',
  '.git',
  'out',
  'dist',
  'build',
  'target',
];

/* [por que] Devuelve un Set nuevo para que ningún analizador mute la base compartida. */
export function exclusionesCon(extras: readonly string[] = []): Set<string> {
  return new Set([...EXCLUSIONES_BASE, ...extras]);
}
