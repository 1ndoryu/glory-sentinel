/*
 * Reglas CSS de arquitectura de modales (extraido de staticCssRules.ts).
 *
 * [15A-25] Split mecanico por budget ADR 0001: staticCssRules.ts supero las 700
 * lineas al incorporar los criterios de sujeto/receta/gesto de
 * css-especificacion-diseno-local. Movimiento puro, cero cambio de
 * comportamiento; staticCssRules.ts re-exporta el simbolo para no tocar ningun
 * importador.
 */

import { Violacion } from '../../types';
import { CoreTextDocument } from '../../core/runtime-proyecto/types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { rutaExentaPorProyecto } from '../../config/exencionesProyecto';
import { AjustesProyecto, AJUSTES_PROYECTO_DEFECTO } from '../ajustesProyecto';
import {
  bloqueDefineSemanticaModal,
  claseCanonicaModal,
  sufijoSemanticoModal,
  tieneSentinelDisable,
  tieneSentinelDisableFile,
} from '../../utils/analisisHelpers';

const REGLA_MODAL_SEMANTICA = 'modal-semantica-no-canonica';

/*
 * Detecta clases de modal por componente que duplican semantica compartida.
 * Casos como .ordenDetalleModalTexto o .modalCompraDescripcion deben reutilizar
 * .modalTitulo/.modalAcciones y dejar solo layout o estado local.
 */
export function verificarModalSemanticaNoCanonica(
  texto: string,
  documento: CoreTextDocument,
  nombreArchivo: string,
  /* [119A-4 S4] El caller (staticAnalyzer) lo calcula con proyectoTieneModalCanonico().
   * Default true = fail-closed: sin evidencia de ausencia, la regla dispara como antes. */
  tieneModalCanonico = true,
  /* Las exenciones del proyecto llegan por parámetro: sin estado de módulo entre proyectos. */
  ajustes: AjustesProyecto = AJUSTES_PROYECTO_DEFECTO,
): Violacion[] {
  const nombreLower = nombreArchivo.toLowerCase();
  const rutaNorm = documento.fileName.replace(/\\/g, '/');

  if (/^variables\.css$/.test(nombreLower)) {
    return [];
  }

  if (!tieneModalCanonico) { return []; }

  if (rutaNorm.includes('/node_modules/') || rutaNorm.includes('/vendor/') || rutaExentaPorProyecto(rutaNorm, ajustes.exenciones)) {
    return [];
  }

  if (tieneSentinelDisableFile(texto, REGLA_MODAL_SEMANTICA)) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');
  const regexBloques = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regexBloques.exec(texto)) !== null) {
    const selectorRaw = match[1];
    const selector = selectorRaw.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    const cuerpo = match[2];
    const lineaBase = texto.slice(0, match.index).split('\n').length - 1;
    const linea = lineaBase + (selectorRaw.split('\n').length - 1);

    if (!selector || selector.startsWith('@')) {
      continue;
    }

    if (tieneSentinelDisable(lineas, linea, REGLA_MODAL_SEMANTICA)) {
      continue;
    }

    const clasesSelector = Array.from(selector.matchAll(/\.([A-Za-z_][\w-]*)/g)).map(grupo => grupo[1]);
    const claseProblematica = clasesSelector.find(nombreClase => {
      const sufijo = sufijoSemanticoModal(nombreClase);
      return sufijo ? bloqueDefineSemanticaModal(cuerpo, sufijo) : false;
    });

    if (!claseProblematica) {
      continue;
    }

    const sufijo = sufijoSemanticoModal(claseProblematica);
    if (!sufijo) {
      continue;
    }

    const claseCanonica = claseCanonicaModal(sufijo);
    violaciones.push({
      reglaId: REGLA_MODAL_SEMANTICA,
      mensaje: `La clase "${claseProblematica}" duplica semantica visual compartida de Modal. Usa className="${claseCanonica}" y deja el layout/estado en clases locales separadas.`,
      severidad: obtenerSeveridadRegla(REGLA_MODAL_SEMANTICA),
      linea,
      fuente: 'estatico',
    });
  }

  return violaciones;
}
