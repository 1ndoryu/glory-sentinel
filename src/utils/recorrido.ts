/* Recorrido de directorios compartido por los índices y detectores de Sentinel.
 * La lista de carpetas que nunca son código propio vive aquí, para que los
 * recorridos no diverjan entre sí. */
import * as fs from 'fs';
import * as path from 'path';
import { conjuntoConstante } from './conjuntoConstante';

/* Dependencias, salidas de build, control de versiones y estado de Sentinel: no son código del proyecto. */
export const DIRS_OMITIDOS_COMUNES: ReadonlySet<string> = conjuntoConstante([
  'node_modules', 'vendor', 'dist', 'build', '.git', 'coverage',
  '.quality-tools', '.sentinel', '.quality-reports', 'target',
]);

/* Visita los ficheros de `dir` en profundidad, sin entrar en `omitir`. `visitar` devuelve
 * `true` para parar el recorrido (p. ej. al encontrar lo buscado). Devuelve `true` si paró. */
export function recorrerFicherosSync(
  dir: string,
  visitar: (ruta: string) => boolean | void,
  omitir: ReadonlySet<string> = DIRS_OMITIDOS_COMUNES,
): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    /* Un directorio ilegible (permisos, borrado a mitad) no detiene el resto del recorrido. */
    return false;
  }

  for (const entry of entries) {
    if (omitir.has(entry.name)) { continue; }
    const ruta = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recorrerFicherosSync(ruta, visitar, omitir)) { return true; }
    } else if (entry.isFile() && visitar(ruta) === true) {
      return true;
    }
  }
  return false;
}
