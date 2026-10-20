/* [M-S3] Exenciones por proyecto: rutas y componentes que el analizador no juzga.
 * Por defecto no exime nada; el proyecto activa un perfil con nombre (p. ej. "glory")
 * o lista sus propias rutas y componentes. Mismo patron de setter que marcadoresGlory. */
import type { CoreExenciones } from '../core/runtime-proyecto/types';
import { ExencionesResueltas, PERFILES_EXENCION } from './perfilesExencion';

export type { ExencionesResueltas } from './perfilesExencion';

export const SIN_EXENCIONES: ExencionesResueltas = { rutas: [], componentes: [] };

/* Combina el perfil con las listas propias; sin entrada, no exime nada. */
export function resolverExenciones(entrada?: CoreExenciones): ExencionesResueltas {
  if (!entrada) { return SIN_EXENCIONES; }
  const perfil = entrada.perfil ? PERFILES_EXENCION[entrada.perfil] : undefined;
  return {
    rutas: [...(perfil?.rutas ?? []), ...(entrada.rutas ?? [])],
    componentes: [...(perfil?.componentes ?? []), ...(entrada.componentes ?? [])],
  };
}

/* rutaNorm usa barras '/'; el llamador ya normaliza la ruta. [M-S10] Las exenciones llegan como parámetro. */
export function rutaExentaPorProyecto(rutaNorm: string, exenciones: ExencionesResueltas = SIN_EXENCIONES): boolean {
  return exenciones.rutas.some(fragmento => rutaNorm.includes(fragmento));
}

/* nombreBase es el nombre del componente sin extension. */
export function componenteExentoPorProyecto(nombreBase: string, exenciones: ExencionesResueltas = SIN_EXENCIONES): boolean {
  return exenciones.componentes.includes(nombreBase);
}
