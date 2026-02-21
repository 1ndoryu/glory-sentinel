/*
 * Cargador de reglas desde el archivo de protocolo del usuario.
 * Lee los .md de instrucciones y carga su contenido para inyectarlo
 * en los prompts de IA, combinando reglas builtin con reglas custom.
 */

import * as vscode from 'vscode';
import { ConfiguracionSentinel } from '../types';
import { logInfo, logWarn } from '../utils/logger';
import { invalidarRegistroReglas } from '../config/ruleRegistry';

/* Cache del contenido de reglas custom para no releer en cada recarga */
let cacheReglasCustom: string = '';
let cacheReglasHash: string = '';

/*
 * Carga la configuracion completa desde settings.json de VS Code.
 * El contenido de los archivos de reglas se carga async por separado.
 */
export function cargarConfiguracion(): ConfiguracionSentinel {
  const config = vscode.workspace.getConfiguration('codeSentinel');

  /* Soportar tanto rulesFile (string, backward compat) como rulesFiles (array) */
  const rulesFileSingle = config.get<string>('rulesFile', '');
  const rulesFilesArray = config.get<string[]>('rulesFiles', []);

  /* Combinar: si el usuario tiene ambos, se usan los dos sin duplicar */
  const archivosReglas = [...new Set([
    ...(rulesFileSingle ? [rulesFileSingle] : []),
    ...rulesFilesArray,
  ])];

  return {
    staticAnalysisEnabled: config.get<boolean>('staticAnalysis.enabled', true),
    aiAnalysisEnabled: config.get<boolean>('aiAnalysis.enabled', true),
    aiModelFamily: config.get<string>('ai.modelFamily', 'gpt-5-mini'),
    aiBackend: config.get<string>('ai.backend', 'copilot'),
    geminiModel: config.get<string>('ai.geminiModel', 'flash-min'),
    timing: {
      staticDebounceMs: (config.get<number>('timing.staticDebounce', 1)) * 1000,
      aiDelayOnOpenMs: (config.get<number>('timing.aiDelayOnOpen', 5)) * 1000,
      aiDelayOnEditMs: (config.get<number>('timing.aiDelayOnEdit', 30)) * 1000,
      aiCooldownMs: (config.get<number>('timing.aiCooldown', 300)) * 1000,
      aiTimeoutMs: (config.get<number>('timing.aiTimeout', 45)) * 1000,
    },
    limits: {
      maxAiRequestsPerMinute: config.get<number>('limits.maxAiRequestsPerMinute', 30),
      maxFileSizeForAiKb: config.get<number>('limits.maxFileSizeForAiKb', 100),
    },
    rulesFile: rulesFileSingle,
    rulesFiles: archivosReglas,
    customRulesContent: cacheReglasCustom,
    exclude: config.get<string[]>('exclude', [
      '**/node_modules/**',
      '**/vendor/**',
      '**/dist/**',
      '**/_generated/**',
      '**/out/**',
      /* Caches de herramientas de build/docs que generan archivos automaticos */
      '**/.vitepress/cache/**',
      '**/build/**',
      /* La extension no debe analizarse a si misma */
      '**/.agent/code-sentinel/**',
    ]),
    languages: config.get<string[]>('languages', [
      'php', 'typescript', 'typescriptreact',
      'javascript', 'javascriptreact', 'css',
    ]),
  };
}

/*
 * Carga el contenido de los archivos de reglas del usuario.
 * Se llama una vez al activar y cada vez que cambia la config.
 * El contenido se inyecta en los prompts de IA como reglas adicionales.
 */
export async function cargarReglasCustom(archivosReglas: string[]): Promise<string> {
  if (archivosReglas.length === 0) {
    return '';
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return '';
  }

  const contenidos: string[] = [];

  for (const archivo of archivosReglas) {
    try {
      const rutaCompleta = vscode.Uri.joinPath(workspaceFolders[0].uri, archivo);
      const bytes = await vscode.workspace.fs.readFile(rutaCompleta);
      const texto = Buffer.from(bytes).toString('utf-8');

      /* Extraer solo las secciones relevantes para analisis de codigo.
       * Se omite frontmatter YAML y metadata que no son reglas. */
      const contenidoLimpio = extraerReglasDeMarkdown(texto);

      if (contenidoLimpio.length > 0) {
        contenidos.push(`/* Reglas de: ${archivo} */\n${contenidoLimpio}`);
        logInfo(`Reglas custom cargadas: ${archivo} (${Math.round(contenidoLimpio.length / 1024)}KB)`);
      }
    } catch (error) {
      logWarn(`No se pudo leer archivo de reglas: ${archivo} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const resultado = contenidos.join('\n\n');
  cacheReglasCustom = resultado;
  return resultado;
}

/*
 * Extrae las secciones de reglas de un archivo markdown.
 * Remueve frontmatter YAML, bloques de codigo de ejemplo extensos,
 * y trunca si el contenido es demasiado largo para el contexto del modelo.
 */
function extraerReglasDeMarkdown(texto: string): string {
  let limpio = texto;

  /* Remover frontmatter YAML (---...---) */
  limpio = limpio.replace(/^---[\s\S]*?---\s*/m, '');

  /* Truncar a un tamano razonable para el prompt (~12KB max) para no
   * saturar el contexto del modelo con texto irrelevante. */
  const MAX_CHARS = 12_000;
  if (limpio.length > MAX_CHARS) {
    limpio = limpio.substring(0, MAX_CHARS) + '\n[... reglas truncadas por tamano ...]';
  }

  return limpio.trim();
}

/* Invalida el cache de reglas custom y el registro de reglas (al cambiar configuracion) */
export function invalidarCacheReglas(): void {
  cacheReglasCustom = '';
  cacheReglasHash = '';
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

/*
 * Verifica que al menos uno de los archivos de reglas existe.
 * Retorna true si al menos uno existe y es legible.
 */
export async function verificarArchivosReglas(archivosReglas: string[]): Promise<boolean> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return false;
  }

  for (const archivo of archivosReglas) {
    try {
      const rutaCompleta = vscode.Uri.joinPath(workspaceFolders[0].uri, archivo);
      await vscode.workspace.fs.stat(rutaCompleta);
      return true;
    } catch {
      /* continuar con el siguiente */
    }
  }

  return false;
}
