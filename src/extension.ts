/*
 * Punto de entrada de la extension Code Sentinel.
 * Registra providers, comandos y listeners.
 * Se activa al abrir archivos de los lenguajes configurados.
 */

import * as vscode from 'vscode';
import {
  inicializarDiagnosticProvider,
  forzarAnalisisArchivo,
  analizarWorkspace,
  limpiarDiagnosticos,
} from './providers/diagnosticProvider';
import { SentinelCodeActionProvider } from './providers/codeActionProvider';
import { cargarConfiguracion, verificarArchivosReglas } from './services/ruleLoader';
import { categoriasRegla } from './config/ruleCategories';
import { reglasEstaticas } from './config/defaultRules';
import { inicializarCanal, logInfo } from './utils/logger';

/* Estado global de si la IA esta habilitada (para toggle rapido) */
let iaHabilitada = true;


/*
 * Funcion de activacion de la extension.
 * Se ejecuta cuando se abre un archivo de un lenguaje soportado.
 */
export function activate(context: vscode.ExtensionContext): void {
  /* Inicializar canal de output PRIMERO para que todos los logs sean visibles */
  inicializarCanal(context);

  const config = cargarConfiguracion();
  iaHabilitada = config.aiAnalysisEnabled;

  logInfo(`Code Sentinel activado. ${reglasEstaticas.length} reglas estaticas cargadas.`);
  const backendIA = config.aiBackend === 'gemini-cli'
    ? `Gemini CLI (modelo: ${config.geminiModel})`
    : `Copilot vscode.lm (modelo: ${config.aiModelFamily})`;
  logInfo(`IA: ${iaHabilitada ? 'habilitada' : 'deshabilitada'} — backend: ${backendIA}`);

  /* Inicializar provider de diagnosticos (corazon de la extension) */
  inicializarDiagnosticProvider(context);

  /* Registrar CodeActionProvider para quick fixes */
  const selectorDocumentos: vscode.DocumentSelector = config.languages.map(lang => ({
    language: lang,
    scheme: 'file',
  }));

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selectorDocumentos,
      new SentinelCodeActionProvider(),
      { providedCodeActionKinds: SentinelCodeActionProvider.providedCodeActionKinds }
    )
  );

  /* Registrar comandos */
  context.subscriptions.push(
    vscode.commands.registerCommand('codeSentinel.analyzeFile', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        forzarAnalisisArchivo(editor.document.uri);
        vscode.window.showInformationMessage('Code Sentinel: Analisis completo ejecutado.');
      } else {
        vscode.window.showWarningMessage('Code Sentinel: No hay archivo activo para analizar.');
      }
    }),

    vscode.commands.registerCommand('codeSentinel.analyzeWorkspace', async () => {
      await analizarWorkspace();
      vscode.window.showInformationMessage('Code Sentinel: Analisis de workspace completado.');
    }),

    vscode.commands.registerCommand('codeSentinel.clearDiagnostics', () => {
      limpiarDiagnosticos();
      vscode.window.showInformationMessage('Code Sentinel: Diagnosticos limpiados.');
    }),

    vscode.commands.registerCommand('codeSentinel.toggleAI', () => {
      iaHabilitada = !iaHabilitada;
      const estado = iaHabilitada ? 'activado' : 'desactivado';
      vscode.window.showInformationMessage(`Code Sentinel: Analisis IA ${estado}.`);

      /* Actualizar configuracion */
      vscode.workspace.getConfiguration('codeSentinel').update(
        'aiAnalysis.enabled',
        iaHabilitada,
        vscode.ConfigurationTarget.Workspace
      );
    }),

    vscode.commands.registerCommand('codeSentinel.showRulesSummary', () => {
      mostrarResumenReglas();
    })
  );

  /* Verificar que al menos un archivo de reglas existe */
  verificarArchivosReglas(config.rulesFiles).then(existe => {
    if (!existe && config.rulesFiles.length > 0) {
      vscode.window.showWarningMessage(
        `Code Sentinel: Ningun archivo de reglas encontrado (${config.rulesFiles.join(', ')}). Usando reglas builtin.`
      );
    }
  });
}

/* Muestra un webview con el resumen de reglas activas */
function mostrarResumenReglas(): void {
  const panel = vscode.window.createWebviewPanel(
    'codeSentinelRules',
    'Code Sentinel - Reglas',
    vscode.ViewColumn.Beside,
    {}
  );

  let html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
    h1 { color: var(--vscode-textLink-foreground); }
    h2 { margin-top: 24px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
    table { border-collapse: collapse; width: 100%; margin-top: 8px; }
    th, td { text-align: left; padding: 6px 12px; border: 1px solid var(--vscode-panel-border); }
    th { background: var(--vscode-editor-background); }
    .error { color: var(--vscode-errorForeground); }
    .warning { color: var(--vscode-editorWarning-foreground); }
    .info { color: var(--vscode-editorInfo-foreground); }
  </style>
</head>
<body>
  <h1>Code Sentinel - Reglas Activas</h1>
  <p>${reglasEstaticas.length} reglas estaticas | IA: ${iaHabilitada ? 'Habilitada' : 'Deshabilitada'}</p>`;

  for (const categoria of categoriasRegla) {
    const reglasCategoria = reglasEstaticas.filter(r => r.categoria === categoria.id);
    if (reglasCategoria.length === 0) { continue; }

    html += `
  <h2>${categoria.nombre} (${categoria.seccionProtocolo})</h2>
  <p>${categoria.descripcion}</p>
  <table>
    <tr><th>ID</th><th>Nombre</th><th>Severidad</th><th>Aplica a</th></tr>`;

    for (const regla of reglasCategoria) {
      const clasesSeveridad = regla.severidad === 'error' ? 'error'
        : regla.severidad === 'warning' ? 'warning' : 'info';
      html += `
    <tr>
      <td><code>${regla.id}</code></td>
      <td>${regla.nombre}</td>
      <td class="${clasesSeveridad}">${regla.severidad}</td>
      <td>${regla.aplicaA.join(', ')}</td>
    </tr>`;
    }

    html += `
  </table>`;
  }

  html += `
</body>
</html>`;

  panel.webview.html = html;
}

/* Funcion de desactivacion de la extension */
export function deactivate(): void {
  limpiarDiagnosticos();
}
