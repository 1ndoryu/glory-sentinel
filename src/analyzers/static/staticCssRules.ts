/*
 * Reglas CSS para el analyzer estatico.
 * Detecta: nomenclatura en ingles (protocolo requiere espanol),
 * colores hardcodeados (desactivada por defecto).
 */

import * as vscode from 'vscode';
import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';

/*
 * Detecta clases CSS con nombres en ingles.
 * El protocolo requiere nombres en espanol (ej: .contenedor, .boton).
 * Excluye librerias, clases de estado (active, disabled, etc.) y sidebar.
 */
export function verificarNomenclaturaCssIngles(
  texto: string,
  documento: vscode.TextDocument,
  nombreArchivo: string,
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

/*
 * Detecta colores y valores hardcodeados en CSS que deberian usar variables.
 * Desactivada por decision de producto (falsos positivos con valores literales validos).
 */
export function verificarCssHardcoded(
  texto: string,
  documento: vscode.TextDocument,
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
