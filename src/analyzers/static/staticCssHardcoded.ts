/* Reglas CSS de colores y valores hardcodeados (desactivada por producto). Extraido de staticCssRules.ts. */
import { Violacion } from '../../types';
import { CoreTextDocument } from '../../core/runtime-proyecto/types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';

/*
 * Detecta colores y valores hardcodeados en CSS que deberian usar variables.
 * Desactivada por decision de producto (falsos positivos con valores literales validos).
 */
export function verificarCssHardcoded(
  texto: string,
  documento: CoreTextDocument,
  nombreArchivo: string,
): Violacion[] {
  const nombreLower = nombreArchivo.toLowerCase();
  if (/variables\.css|init\.css|theme\.css|tokens\.css/.test(nombreLower)) {
    return [];
  }

  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  if (rutaNorm.includes('node_modules') || rutaNorm.includes('vendor')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');
  let dentroRoot = false;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) { continue; }
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line css-hardcoded-value')) { continue; }

    /* Rastrear bloque :root */
    if (/:root\s*\{/.test(linea)) { dentroRoot = true; }
    if (dentroRoot && /\}/.test(linea)) { dentroRoot = false; }
    if (dentroRoot) { continue; }

    /* Saltar definiciones de variables CSS y lineas con var() */
    if (/^\s*--/.test(lineas[i])) { continue; }
    if (/var\s*\(/.test(linea)) { continue; }

    /* [119A-4 S2] mask-image usa el color como luminancia: cualquier valor
     * opaco vale (#000 es la convencion). No es deuda de design system. */
    const propiedadLinea = /^([\w-]+)\s*:/.exec(linea)?.[1]?.toLowerCase();
    if (propiedadLinea === 'mask-image' || propiedadLinea === '-webkit-mask-image') { continue; }

    /* Detectar colores hex */
    if (/#[0-9a-fA-F]{3,8}\b/.test(linea)) {
      const antesHash = linea.indexOf('#');
      const antesComentario = linea.indexOf('//');
      if (antesComentario >= 0 && antesComentario < antesHash) { continue; }

      violaciones.push({
        reglaId: 'css-hardcoded-value',
        mensaje: 'Color hex hardcodeado. Usar variable CSS: var(--color-nombre).',
        severidad: obtenerSeveridadRegla('css-hardcoded-value'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    /* Detectar rgb/rgba/hsl/hsla */
    if (/\b(rgba?|hsla?)\s*\(/.test(linea)) {
      violaciones.push({
        reglaId: 'css-hardcoded-value',
        mensaje: 'Color rgb/hsl hardcodeado. Usar variable CSS: var(--color-nombre).',
        severidad: obtenerSeveridadRegla('css-hardcoded-value'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
