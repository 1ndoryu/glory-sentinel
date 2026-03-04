/*
 * Analyzer PHP/WordPress  Fachada.
 * Delega en submodulos: phpControllerRules, phpDataRules, phpSecurityRules.
 */

import * as vscode from 'vscode';
import { Violacion } from '../types';
import { reglaHabilitada } from '../config/ruleRegistry';

import { verificarControllerSinTryCatch } from './php/phpControllerRules';
import {
  verificarWpdbSinPrepareContextual,
  verificarRequestJsonDirecto,
  verificarJsonDecodeInseguro,
} from './php/phpDataRules';
import {
  verificarExecSinEscape,
  verificarCurlSinVerificacion,
  verificarArchivosTemporalesSinFinally,
  verificarSanitizacionFaltante,
} from './php/phpSecurityRules';

/*
 * Analiza un archivo PHP en busca de violaciones especificas de WordPress.
 * Complementa al staticAnalyzer con reglas que requieren contexto PHP.
 */
export function analizarPhp(documento: vscode.TextDocument): Violacion[] {
  const lineas = documento.getText().split('\n');
  const violaciones: Violacion[] = [];

  if (reglaHabilitada('controller-sin-trycatch')) {
    violaciones.push(...verificarControllerSinTryCatch(lineas));
  }
  if (reglaHabilitada('wpdb-sin-prepare')) {
    violaciones.push(...verificarWpdbSinPrepareContextual(lineas));
  }
  if (reglaHabilitada('request-json-directo')) {
    violaciones.push(...verificarRequestJsonDirecto(lineas));
  }
  if (reglaHabilitada('json-decode-inseguro')) {
    violaciones.push(...verificarJsonDecodeInseguro(lineas));
  }
  if (reglaHabilitada('exec-sin-escapeshellarg')) {
    violaciones.push(...verificarExecSinEscape(lineas));
  }
  if (reglaHabilitada('curl-sin-verificacion')) {
    violaciones.push(...verificarCurlSinVerificacion(lineas));
  }
  if (reglaHabilitada('temp-sin-finally')) {
    violaciones.push(...verificarArchivosTemporalesSinFinally(lineas));
  }
  if (reglaHabilitada('sanitizacion-faltante')) {
    violaciones.push(...verificarSanitizacionFaltante(lineas));
  }

  return violaciones;
}
