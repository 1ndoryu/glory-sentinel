/*
 * Provider principal de diagnosticos.
 * Coordina el analisis estatico e IA, convierte violaciones
 * a diagnosticos nativos de VS Code y los publica.
 */

import * as vscode from 'vscode';
import { ConfiguracionSentinel } from '../types';
import { limpiarDirectoriosReportados } from '../analyzers/staticAnalyzer';
import { analizarGlory } from '../analyzers/gloryAnalyzer';
import { analizarApiEndpoints } from '../analyzers/apiEndpointAnalyzer';
import { guardarEnCache, obtenerDelCache, limpiarCacheCompleto } from '../services/cacheService';
import { logInfo, logWarn } from '../utils/logger';
import {
  programarAnalisisEstatico,
  registrarCallbacks,
  limpiarEstado,
  limpiarTodo,
  actualizarResultados,
} from '../services/debounceService';
import { cargarConfiguracion, debeExcluirse, lenguajeHabilitado, invalidarCacheReglas } from '../services/ruleLoader';
import { generarReporteWorkspace } from './reportGenerator';
import { analyzeDocument } from '../core/analyzeDocument';
import { CoreAnalysisConfig, CoreWorkspaceContext } from '../core/types';
import { documentFromVsCode, findingToDiagnostic } from '../core/vscodeAdapter';

/* DiagnosticCollection global de la extension */
let coleccionDiagnosticos: vscode.DiagnosticCollection;
let configuracion: ConfiguracionSentinel;

function crearCoreConfig(): CoreAnalysisConfig {
  return {
    enabled: configuracion.staticAnalysisEnabled,
    includePatterns: [],
    excludePatterns: configuracion.exclude,
    directoryExceptions: configuracion.directoryExceptions,
    ruleOverrides: {},
    useConfiguredRuleProvider: true,
  };
}

function crearWorkspaceContext(doc: vscode.TextDocument): CoreWorkspaceContext | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri)
    ?? vscode.workspace.workspaceFolders?.find(workspaceFolder => {
      const fileNorm = doc.fileName.replace(/\\/g, '/');
      return fileNorm.startsWith(workspaceFolder.uri.fsPath.replace(/\\/g, '/'));
    });

  if (!folder) {
    return undefined;
  }

  return {
    rootPath: folder.uri.fsPath,
    config: crearCoreConfig(),
  };
}

function analizarDocumentoVsCode(doc: vscode.TextDocument): vscode.Diagnostic[] {
  const coreDocument = documentFromVsCode(doc);
  const findings = analyzeDocument(coreDocument, crearCoreConfig(), crearWorkspaceContext(doc), {
    extraAnalyzers: [
      () => analizarGlory(doc),
      () => analizarApiEndpoints(doc),
    ],
  });

  return findings.map(findingToDiagnostic);
}

/*
 * Inicializa el provider de diagnosticos.
 * Registra la coleccion, callbacks y listeners de eventos.
 */
export function inicializarDiagnosticProvider(
  context: vscode.ExtensionContext
): vscode.DiagnosticCollection {
  coleccionDiagnosticos = vscode.languages.createDiagnosticCollection('codeSentinel');
  context.subscriptions.push(coleccionDiagnosticos);

  configuracion = cargarConfiguracion();

  /* Registrar callbacks para el servicio de debounce */
  registrarCallbacks(
    (uri) => ejecutarAnalisisEstatico(uri)
  );

  /* Listeners de eventos del editor.
   * NOTA: NO usar onDidOpenTextDocument porque VS Code lo dispara para TODOS
   * los documentos que carga en memoria (git, previews, IntelliSense, extensiones),
   * no solo los que el usuario abre visiblemente. Esto causaba analisis innecesarios.
   * En su lugar, usamos onDidChangeVisibleTextEditors para reaccionar solo
   * cuando el usuario realmente ve un archivo. */
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => alCambiarEditoresVisibles(editors)),
    vscode.workspace.onDidChangeTextDocument((e) => alCambiarDocumento(e)),
    vscode.workspace.onDidCloseTextDocument((doc) => alCerrarDocumento(doc)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codeSentinel')) {
        alCambiarConfiguracion();
      }
    })
  );

  /* Analizar solo editores visibles al activar */
  const docsVisibles = vscode.window.visibleTextEditors.map(e => e.document);
  for (const doc of docsVisibles) {
    if (documentoEsValido(doc)) {
      ejecutarAnalisisEstatico(doc.uri);
    }
  }

  return coleccionDiagnosticos;
}

/* Ejecuta el analisis estatico completo para un archivo */
function ejecutarAnalisisEstatico(uri: vscode.Uri): void {
  const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (!doc || !documentoEsValido(doc)) {
    return;
  }

  /* Verificar cache */
  const contenido = doc.getText();
  const cacheado = obtenerDelCache(uri, contenido);
  if (cacheado) {
    publicarDiagnosticos(uri, cacheado);
    return;
  }

  const diagnosticos = analizarDocumentoVsCode(doc);

  /* Guardar en cache y publicar */
  guardarEnCache(uri, contenido, diagnosticos);
  publicarDiagnosticos(uri, diagnosticos);
}

/* Publica diagnosticos en la coleccion de VS Code */
function publicarDiagnosticos(
  uri: vscode.Uri,
  nuevosDiagnosticos: vscode.Diagnostic[]
): void {
  actualizarResultados(uri, nuevosDiagnosticos);
  coleccionDiagnosticos.set(uri, nuevosDiagnosticos);
}

/* Verifica si un documento es valido para analisis */
function documentoEsValido(doc: vscode.TextDocument): boolean {
  /* Excluir esquemas no-archivo */
  if (doc.uri.scheme !== 'file') {
    return false;
  }

  /* Verificar lenguaje habilitado */
  if (!lenguajeHabilitado(doc.languageId, configuracion.languages)) {
    return false;
  }

  /* Verificar exclusiones */
  if (debeExcluirse(doc.fileName, configuracion.exclude)) {
    return false;
  }

  return true;
}

/* Set de URIs de editores que ya fueron analizados, para no repetir al cambiar de tab */
const editoresAnalizados = new Set<string>();

/* Handlers de eventos */

/*
 * Se dispara cuando cambian los editores visibles (el usuario abre un archivo,
 * cambia de tab, split view, etc). Solo analiza documentos NUEVOS que no
 * estaban visibles antes. Reemplaza onDidOpenTextDocument que disparaba
 * para archivos en memoria que el usuario no estaba viendo.
 */
function alCambiarEditoresVisibles(editors: readonly vscode.TextEditor[]): void {
  for (const editor of editors) {
    const doc = editor.document;
    const key = doc.uri.toString();

    if (!documentoEsValido(doc)) {
      continue;
    }

    /* Solo analizar si es un editor nuevo que no hemos visto */
    if (editoresAnalizados.has(key)) {
      continue;
    }
    editoresAnalizados.add(key);

    /* Analisis estatico inmediato */
    ejecutarAnalisisEstatico(doc.uri);
  }
}

function alCambiarDocumento(event: vscode.TextDocumentChangeEvent): void {
  if (!documentoEsValido(event.document)) {
    return;
  }

  /* Programar analisis estatico con debounce */
  if (configuracion.staticAnalysisEnabled) {
    programarAnalisisEstatico(event.document.uri, configuracion);
  }
}

function alCerrarDocumento(doc: vscode.TextDocument): void {
  limpiarEstado(doc.uri);
  editoresAnalizados.delete(doc.uri.toString());
  coleccionDiagnosticos.delete(doc.uri);
}

function alCambiarConfiguracion(): void {
  configuracion = cargarConfiguracion();
  invalidarCacheReglas();
  limpiarCacheCompleto();

  /* Re-analizar documentos abiertos con nueva configuracion */
  for (const doc of vscode.workspace.textDocuments) {
    if (documentoEsValido(doc)) {
      ejecutarAnalisisEstatico(doc.uri);
    }
  }
}

/* Expone funciones para los comandos de la extension */
export function forzarAnalisisArchivo(uri: vscode.Uri): void {
  ejecutarAnalisisEstatico(uri);
}

export async function analizarWorkspace(): Promise<void> {
  /* [124A-FP1] Limpiar dedup de directorio-abarrotado al inicio de cada scan */
  limpiarDirectoriosReportados();

  /* Construir patron de exclusion desde configuracion (no hardcodeado) */
  const patronExclusion = configuracion.exclude.length > 0
    ? `{${configuracion.exclude.join(',')}}`
    : undefined;

  const archivos = await vscode.workspace.findFiles(
    '**/*.{php,ts,tsx,js,jsx,css,rs}',
    patronExclusion
  );

  /* Mapa para recopilar resultados y generar el reporte */
  const resultadosReporte = new Map<string, { ruta: string; diagnosticos: vscode.Diagnostic[] }>();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Code Sentinel: Analizando workspace...',
      cancellable: true,
    },
    async (progress, token) => {
      for (let i = 0; i < archivos.length; i++) {
        if (token.isCancellationRequested) {
          break;
        }

        progress.report({
          increment: (100 / archivos.length),
          message: `${i + 1}/${archivos.length} archivos`,
        });

        try {
          /* Filtro secundario: findFiles con glob combinado no excluye todo en VS Code.
           * debeExcluirse garantiza que archivos de vendor/target/agent nunca se analicen. */
          if (debeExcluirse(archivos[i].fsPath, configuracion.exclude)) {
            continue;
          }

          const doc = await vscode.workspace.openTextDocument(archivos[i]);
          if (documentoEsValido(doc)) {
            const diagnosticos = analizarDocumentoVsCode(doc);
            coleccionDiagnosticos.set(archivos[i], diagnosticos);

            /* Solo incluir archivos con violaciones en el reporte */
            if (diagnosticos.length > 0) {
              resultadosReporte.set(archivos[i].fsPath, {
                ruta: archivos[i].fsPath,
                diagnosticos,
              });
            }
          }
        } catch (error) {
          /* Algunos archivos pueden no abrirse (binarios, etc.) */
          logWarn(`No se pudo analizar: ${archivos[i].fsPath} — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  /* Generar archivo de reporte tras el analisis */
  await generarReporteWorkspace(resultadosReporte, archivos.length);
}

export function limpiarDiagnosticos(): void {
  coleccionDiagnosticos.clear();
  limpiarTodo();
  limpiarCacheCompleto();
  /* [124A-AUDIT1] Limpiar set de editores analizados para evitar acumulación sin límite */
  editoresAnalizados.clear();
}

/* Expone la coleccion de diagnosticos para uso desde otros modulos (ej: externalToolsAnalyzer) */
export function obtenerColeccionDiagnosticos(): vscode.DiagnosticCollection | null {
  return coleccionDiagnosticos ?? null;
}
