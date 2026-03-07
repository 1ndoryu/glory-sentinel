/*
 * Analyzer PHP/WordPress  Fachada.
 * Delega en submodulos: phpControllerRules, phpDataRules, phpSecurityRules.
 */

import * as vscode from 'vscode';
import { Violacion } from '../types';
import { reglaHabilitada } from '../config/ruleRegistry';

import { verificarControllerSinTryCatch, verificarLockSinFinally, verificarCatchCriticoSoloLog } from './php/phpControllerRules';
import {
  verificarWpdbSinPrepareContextual,
  verificarRequestJsonDirecto,
  verificarJsonDecodeInseguro,
  verificarToctouSelectInsert,
  verificarCadenaIssetUpdate,
  verificarQueryDobleVerificacion,
  verificarJsonSinLimiteBd,
  verificarRetornoIgnoradoRepo,
} from './php/phpDataRules';
import {
  verificarExecSinEscape,
  verificarCurlSinVerificacion,
  verificarArchivosTemporalesSinFinally,
  verificarSanitizacionFaltante,
  verificarMimeTypeCliente,
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

  /* Sprint 8: Nuevas reglas PHP */
  if (reglaHabilitada('lock-sin-finally')) {
    violaciones.push(...verificarLockSinFinally(lineas));
  }
  if (reglaHabilitada('catch-critico-solo-log')) {
    violaciones.push(...verificarCatchCriticoSoloLog(lineas));
  }
  if (reglaHabilitada('toctou-select-insert')) {
    violaciones.push(...verificarToctouSelectInsert(lineas));
  }
  if (reglaHabilitada('cadena-isset-update')) {
    violaciones.push(...verificarCadenaIssetUpdate(lineas));
  }
  if (reglaHabilitada('query-doble-verificacion')) {
    violaciones.push(...verificarQueryDobleVerificacion(lineas));
  }
  if (reglaHabilitada('json-sin-limite-bd')) {
    violaciones.push(...verificarJsonSinLimiteBd(lineas));
  }
  if (reglaHabilitada('retorno-ignorado-repo')) {
    violaciones.push(...verificarRetornoIgnoradoRepo(lineas));
  }
  if (reglaHabilitada('mime-type-cliente')) {
    violaciones.push(...verificarMimeTypeCliente(lineas));
  }

  return violaciones;
}
