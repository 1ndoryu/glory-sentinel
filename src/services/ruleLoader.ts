/*
 * Cargador de configuracion y utilidades de filtrado.
 * Lee ajustes desde settings.json de VS Code y provee funciones
 * de exclusion y habilitacion de lenguajes.
 */

import * as vscode from 'vscode';
import { minimatch } from 'minimatch';
import { ConfiguracionSentinel } from '../types';
import { configurarProveedorOverridesReglas, invalidarRegistroReglas, ConfigReglaUsuario } from '../config/ruleRegistry';

/*
 * Carga la configuracion completa desde settings.json de VS Code.
 */
/* Patrones esenciales que siempre se aplican, incluso si el usuario
 * sobreescribe codeSentinel.exclude en sus settings. */
const EXCLUSIONES_ESENCIALES = [
  '**/node_modules/**',
  '**/vendor/**',
  '**/.agent/**',
  '**/target/**',
];

export function cargarConfiguracion(): ConfiguracionSentinel {
  const config = vscode.workspace.getConfiguration('codeSentinel');
  configurarProveedorOverridesReglas(() => {
    const reglasConfig = vscode.workspace.getConfiguration('codeSentinel');
    return reglasConfig.get<Record<string, ConfigReglaUsuario>>('rules', {});
  });

  const userExclude = config.get<string[]>('exclude', [
    '**/node_modules/**',
    '**/vendor/**',
    '**/dist/**',
    '**/_generated/**',
    '**/out/**',
    '**/.vitepress/cache/**',
    '**/build/**',
    '**/desktop/src-tauri/**',
    '**/desktop/node_modules/**',
    '**/desktop/dist/**',
    '**/Mezclador/**',
    '**/temp/**',
    '**/.vscode-test/**',
    '**/.agent/**',
    '**/target/**',
    '**/scripts/**',
    '**/public/assets/**',
    '**/api/generated.ts',
  ]);

  /* Merge esencial: si el usuario sobreescribio exclude y olvido patrones clave,
     los agregamos automaticamente. */
  const exclude = [...userExclude];
  for (const p of EXCLUSIONES_ESENCIALES) {
    if (!exclude.includes(p)) {
      exclude.push(p);
    }
  }

  return {
    staticAnalysisEnabled: config.get<boolean>('staticAnalysis.enabled', true),
    timing: {
      staticDebounceMs: (config.get<number>('timing.staticDebounce', 1)) * 1000,
    },
    exclude,
    directoryExceptions: config.get<string[]>('directoryExceptions', []),
    languages: config.get<string[]>('languages', [
      'php', 'typescript', 'typescriptreact',
      'javascript', 'javascriptreact', 'css', 'rust',
    ]),
  };
}

/* Invalida el registro de reglas (al cambiar configuracion) */
export function invalidarCacheReglas(): void {
  invalidarRegistroReglas();
}

/* [225A-1] Verifica si un archivo debe excluirse usando minimatch (antes usaba
 * string parsing custom que fallaba con patrones como Mezclador,
 * desktop/node_modules, etc.). */
export function debeExcluirse(rutaArchivo: string, exclusiones: string[]): boolean {
  const rutaNormalizada = rutaArchivo.replace(/\\/g, '/');

  for (const patron of exclusiones) {
    if (minimatch(rutaNormalizada, patron, { dot: true })) {
      return true;
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
