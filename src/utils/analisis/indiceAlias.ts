/* Resolucion de imports y alias de tsconfig; pertenencia de clases aplicadas. Extraido de src/utils/analisisHelpers.ts (fachada). */
import { AliasModulo, EnlaceClases } from './indiceTipos';
import { normalizarRuta } from './rutasYContenido';
import * as fs from 'fs';
import * as path from 'path';

const EXTENSIONES_MODULO = ['.ts', '.tsx', '.js', '.jsx'];
export const VACIO: EnlaceClases = { clases: [], prefijos: [] };

/* [15A-27] Resuelve un especificador de import a un fichero del proyecto.
 * Solo relativo o por alias: un paquete de node_modules no interesa, y un
 * especificador que no se puede seguir devuelve null (fail-closed: la falta de
 * evidencia no exime). */
export function resolverModulo(desde: string, especificador: string, alias: AliasModulo[]): string | null {
  let base: string | null = null;

  if (especificador.startsWith('.')) {
    base = path.resolve(path.dirname(desde), especificador);
  } else {
    const encontrado = alias.find(a => especificador.startsWith(a.prefijo));
    if (encontrado) { base = path.join(encontrado.base, especificador.slice(encontrado.prefijo.length)); }
  }

  if (!base) { return null; }

  const candidatos = [
    base,
    ...EXTENSIONES_MODULO.map(extension => base + extension),
    ...EXTENSIONES_MODULO.map(extension => path.join(base, `index${extension}`)),
  ];

  for (const candidato of candidatos) {
    try {
      if (fs.statSync(candidato).isFile()) { return normalizarRuta(candidato); }
    } catch {
      /* candidato inexistente: se prueba el siguiente */
    }
  }

  return null;
}

/* [15A-27] Lee los `paths` de los tsconfig del proyecto. Los tsconfig reales
 * llevan comentarios, asi que se limpian antes de parsear; si no se puede leer
 * uno, se ignora y se sigue (nunca revienta el indice por un tsconfig raro). */
export function leerAliases(ficheros: string[]): AliasModulo[] {
  const alias: AliasModulo[] = [];

  for (const fichero of ficheros) {
    if (!/^tsconfig(\.[\w-]+)?\.json$/.test(path.basename(fichero))) { continue; }

    let crudo: { compilerOptions?: { paths?: Record<string, string[]> } };
    try {
      const texto = fs.readFileSync(fichero, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      crudo = JSON.parse(texto) as typeof crudo;
    } catch {
      continue;
    }

    for (const [clave, destinos] of Object.entries(crudo.compilerOptions?.paths ?? {})) {
      const destino = destinos[0];
      if (!destino) { continue; }
      alias.push({
        prefijo: clave.replace(/\*$/, ''),
        base: normalizarRuta(path.resolve(path.dirname(fichero), destino.replace(/\*$/, ''))),
      });
    }
  }

  /* El prefijo mas largo manda: `@app/x` no debe casar por `@a`. */
  return alias.sort((a, b) => b.prefijo.length - a.prefijo.length);
}

/* [15A-27] Pertenencia al indice con prefijos: `clase` cuenta si esta aplicada
 * tal cual o si empieza por un prefijo que el proyecto arma con plantilla. */
export function claseAplicada(clase: string, aplicadas: Set<string>, prefijos: Set<string>): boolean {
  if (aplicadas.has(clase)) { return true; }

  for (const prefijo of prefijos) {
    if (clase.startsWith(prefijo)) { return true; }
  }

  return false;
}
