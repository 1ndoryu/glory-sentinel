/* [M-S10] Ajustes del proyecto que necesitan los analizadores: marcadores Glory y exenciones.
 * El pipeline los resuelve una vez por documento y los pasa como parámetro;
 * ningún analizador guarda estado de módulo entre proyectos ni entre documentos. */
import type { CoreAnalysisConfig } from '../core/runtime-proyecto/types';
import { MARCADORES_GLORY_DEFECTO } from '../utils/analisis/rutasYContenido';
import { ExencionesResueltas, resolverExenciones } from '../config/exencionesProyecto';

export interface AjustesProyecto {
  marcadoresGlory: readonly string[];
  exenciones: ExencionesResueltas;
}

/* Sin clave en la config (o con lista vacía de marcadores) usa los valores por defecto;
 * sin exenciones, no exime nada. */
export function resolverAjustesProyecto(config: Pick<CoreAnalysisConfig, 'marcadoresGlory' | 'exenciones'>): AjustesProyecto {
  const marcadores = config.marcadoresGlory;
  return {
    marcadoresGlory: marcadores && marcadores.length > 0 ? marcadores : MARCADORES_GLORY_DEFECTO,
    exenciones: resolverExenciones(config.exenciones),
  };
}

/* Ajustes por defecto: los que usan los analizadores cuando se llaman sin pipeline (tests, uso directo). */
export const AJUSTES_PROYECTO_DEFECTO: AjustesProyecto = resolverAjustesProyecto({});
