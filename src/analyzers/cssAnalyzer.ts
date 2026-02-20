/*
 * Analyzer especializado para archivos CSS.
 * Detecta colores hardcodeados (deberian ser variables),
 * nomenclatura en ingles, y otros patrones prohibidos.
 */

import * as vscode from 'vscode';
import { Violacion } from '../types';
import { reglaHabilitada, obtenerSeveridadRegla } from '../config/ruleRegistry';

/* Palabras comunes inglesas que no deberian aparecer en nombres de clase CSS */
const PALABRAS_INGLES_COMUNES = new Set([
  'container', 'wrapper', 'header', 'footer', 'sidebar', 'button',
  'input', 'card', 'modal', 'dropdown', 'tooltip', 'navbar',
  'section', 'content', 'title', 'subtitle', 'description', 'label',
  'icon', 'image', 'link', 'list', 'item', 'badge', 'alert',
  'spinner', 'loader', 'overlay', 'panel', 'tab', 'menu',
  'form', 'field', 'checkbox', 'radio', 'select', 'textarea',
  'table', 'row', 'column', 'cell', 'grid', 'flex',
  'primary', 'secondary', 'success', 'danger', 'warning', 'info',
  'small', 'medium', 'large', 'hidden', 'visible', 'active',
  'disabled', 'selected', 'focused', 'hover', 'dark', 'light',
]);

/*
 * Analiza un archivo CSS en busca de violaciones.
 */
export function analizarCss(documento: vscode.TextDocument): Violacion[] {
  const texto = documento.getText();
  const lineas = texto.split('\n');
  const violaciones: Violacion[] = [];

  /* Solo ejecutar verificaciones cuyas reglas esten habilitadas */
  if (reglaHabilitada('css-color-hardcodeado')) {
    violaciones.push(...verificarColoresHardcodeados(lineas));
  }
  if (reglaHabilitada('css-nomenclatura-ingles')) {
    violaciones.push(...verificarNomenclaturaIngles(lineas));
  }
  if (reglaHabilitada('barras-decorativas')) {
    violaciones.push(...verificarBarrasDecorativas(lineas));
  }

  return violaciones;
}

/*
 * Detecta colores hardcodeados que deberian ser variables CSS.
 * Busca valores hex (#xxx, #xxxxxx) y rgb/rgba fuera de declaraciones de variables.
 */
function verificarColoresHardcodeados(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    /* Saltar declaraciones de variables CSS (ahi es donde se definen) */
    if (linea.startsWith('--') || linea.includes(':root')) {
      continue;
    }

    /* Saltar comentarios */
    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) {
      continue;
    }

    /* Detectar colores hex hardcodeados en propiedades de color/background */
    const matchHex = /(color|background|background-color|border-color|border|outline|box-shadow|text-shadow)\s*:\s*[^;]*?(#[0-9a-fA-F]{3,8})\b/.exec(linea);
    if (matchHex) {
      /* Excluir si ya usa var() */
      if (!linea.includes('var(')) {
        violaciones.push({
          reglaId: 'css-color-hardcodeado',
          mensaje: `Color hardcodeado "${matchHex[2]}" detectado. Usar variable CSS (var(--nombre)) en su lugar.`,
          severidad: obtenerSeveridadRegla('css-color-hardcodeado'),
          linea: i,
          fuente: 'estatico',
        });
      }
    }

    /* Detectar rgb/rgba hardcodeados */
    const matchRgb = /(color|background|background-color|border-color)\s*:\s*[^;]*?(rgba?\s*\([^)]+\))/.exec(linea);
    if (matchRgb && !linea.includes('var(')) {
      violaciones.push({
        reglaId: 'css-color-hardcodeado',
        mensaje: `Color hardcodeado "${matchRgb[2]}" detectado. Usar variable CSS.`,
        severidad: obtenerSeveridadRegla('css-color-hardcodeado'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Detecta clases CSS con nombres en ingles (heuristico).
 * Verifica selectores de clase contra diccionario de palabras inglesas comunes.
 */
function verificarNomenclaturaIngles(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    /* Buscar selectores de clase */
    const matchesCss = linea.matchAll(/\.([a-zA-Z][\w-]*)\s*[{,:\s]/g);
    for (const match of matchesCss) {
      const nombreClase = match[1].toLowerCase();

      /* Verificar si la clase contiene palabras inglesas comunes */
      for (const palabra of PALABRAS_INGLES_COMUNES) {
        if (nombreClase === palabra || nombreClase.startsWith(palabra) || nombreClase.endsWith(palabra)) {
          /* Excluir clases de librerias externas (bootstrap, tailwind, etc.) */
          if (nombreClase.startsWith('wp-') || nombreClase.startsWith('is-') || nombreClase.startsWith('has-')) {
            continue;
          }

          violaciones.push({
            reglaId: 'css-nomenclatura-ingles',
            mensaje: `Clase CSS ".${match[1]}" parece estar en ingles. Usar nombres en espanol y camelCase (.contenedorPrincipal).`,
            severidad: obtenerSeveridadRegla('css-nomenclatura-ingles'),
            linea: i,
            fuente: 'estatico',
          });
          break;
        }
      }
    }
  }

  return violaciones;
}

/* Detecta barras decorativas en comentarios CSS */
function verificarBarrasDecorativas(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (/[=]{4,}/.test(linea) || /[-]{4,}/.test(linea)) {
      /* Verificar que esta dentro de un comentario */
      if (linea.trim().startsWith('/*') || linea.trim().startsWith('*') || linea.trim().startsWith('//')) {
        violaciones.push({
          reglaId: 'barras-decorativas',
          mensaje: 'Barras decorativas en comentario. Usar formato limpio sin decoracion.',
          severidad: obtenerSeveridadRegla('barras-decorativas'),
          linea: i,
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}
