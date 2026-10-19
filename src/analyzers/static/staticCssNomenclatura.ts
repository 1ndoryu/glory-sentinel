/* Reglas de nomenclatura CSS (clases en ingles). Extraido de staticCssRules.ts para cumplir el limite de lineas. */
import { Violacion } from '../../types';
import { CoreTextDocument } from '../../core/runtime-proyecto/types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';

/*
 * Detecta clases CSS con nombres en ingles.
 * El protocolo requiere nombres en espanol (ej: .contenedor, .boton).
 * Excluye librerias, clases de estado (active, disabled, etc.) y sidebar.
 */
export function verificarNomenclaturaCssIngles(
  texto: string,
  documento: CoreTextDocument,
  _nombreArchivo: string,
): Violacion[] {
  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  if (rutaNorm.includes('node_modules') || rutaNorm.includes('vendor') ||
      rutaNorm.includes('shadcn') || rutaNorm.includes('tailwind')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  /* Diccionario de palabras inglesas comunes en selectores CSS.
   * (?!-) evita falsos positivos con prefijos. */
  const regexIngles = /\.(main|container|wrapper|button|header|footer|content|card|item|input|form|modal|dropdown|toggle|alert|tooltip|carousel|slider|pagination|breadcrumb|accordion|spinner|loader|overlay|backdrop|divider|grid|column|flex|stack|box|title|subtitle|heading|label|caption|description|link|icon|thumbnail|table|checkbox|radio|select|textarea|switch|progress|dialog|drawer|menu|toolbar|tag|chip|step|timeline|tree|upload|download|search|filter|sort|block|primary|secondary|dark|light|small|medium|large)\b(?!-)/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) { continue; }
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line nomenclatura-css-ingles')) { continue; }

    const match = regexIngles.exec(linea);
    if (match) {
      violaciones.push({
        reglaId: 'nomenclatura-css-ingles',
        mensaje: `Clase CSS en ingles ".${match[1]}". El protocolo requiere nombres en espanol (ej: .contenedor, .boton).`,
        severidad: obtenerSeveridadRegla('nomenclatura-css-ingles'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
