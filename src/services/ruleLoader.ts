/*
 * Cargador de configuracion y utilidades de filtrado.
 * Lee ajustes desde settings.json de VS Code y provee funciones
 * de exclusion y habilitacion de lenguajes.
 */

import * as vscode from 'vscode';
import { ConfiguracionSentinel } from '../types';
import { invalidarRegistroReglas } from '../config/ruleRegistry';

/*
 * Carga la configuracion completa desde settings.json de VS Code.
 */
export function cargarConfiguracion(): ConfiguracionSentinel {
  const config = vscode.workspace.getConfiguration('codeSentinel');

  return {
    staticAnalysisEnabled: config.get<boolean>('staticAnalysis.enabled', true),
    timing: {
      staticDebounceMs: (config.get<number>('timing.staticDebounce', 1)) * 1000,
    },
    exclude: config.get<string[]>('exclude', [
      '**/node_modules/**',
      '**/vendor/**',
      '**/dist/**',
      '**/_generated/**',
      '**/out/**',
      /* Caches de herramientas de build/docs que generan archivos automaticos */
      '**/.vitepress/cache/**',
      '**/build/**',
      /* Subproyectos y temporales que no son codigo principal */
      '**/desktop/src-tauri/**',
      '**/desktop/node_modules/**',
      '**/desktop/dist/**',
      '**/Mezclador/**',
      '**/temp/**',
      '**/.vscode-test/**',
      /* Agentes, herramientas externas y build outputs */
      '**/.agent/**',
      '**/target/**',
      '**/scripts/**',
    ]),
    languages: config.get<string[]>('languages', [
      'php', 'typescript', 'typescriptreact',
      'javascript', 'javascriptreact', 'css',
    ]),
  };
}

/* Invalida el registro de reglas (al cambiar configuracion) */
export function invalidarCacheReglas(): void {
  invalidarRegistroReglas();
}

/*
 * Verifica si un archivo debe ser excluido del analisis
 * segun los patrones glob configurados.
 */
export function debeExcluirse(rutaArchivo: string, exclusiones: string[]): boolean {
  const rutaNormalizada = rutaArchivo.replace(/\\/g, '/');

  for (const patron of exclusiones) {
    /* Conversion simple de glob a verificacion basica */
    const patronNormalizado = patron.replace(/\\/g, '/');

    /* Patron con doble asterisco significa cualquier subdirectorio */
    if (patronNormalizado.startsWith('**/')) {
      const sufijo = patronNormalizado.slice(3).replace(/\*\*/g, '');
      /* Remover trailing glob wildcard */
      const carpeta = sufijo.replace(/\/\*\*$/, '').replace(/\/$/, '');
      if (rutaNormalizada.includes(`/${carpeta}/`) || rutaNormalizada.includes(`\\${carpeta}\\`)) {
        return true;
      }
    }
  }

  return false;
}

/*
 * Verifica si el lenguaje del documento esta habilitado para analisis.
 */
export function lenguajeHabilitado(languageId: string, lenguajes: string[]): boolean {
  return lenguajes.includes(languageId);
}
