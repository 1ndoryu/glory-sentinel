import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { inicializarGloryAnalyzer } from '../../analyzers/gloryAnalyzer';
import { recargarSchema } from '../../analyzers/glory/schemaLoader';
import { recargarIslasRegistradas } from '../../analyzers/glory/islandTracker';
import { actualizarArchivoEnIndice, recargarIndiceConstantes } from '../../analyzers/glory/phpConstantIndexer';
import { recargarContratos, RUTAS_CONTROLLERS } from '../../analyzers/glory/apiContractIndexer';
import { recargarTipos } from '../../analyzers/glory/tsTypeResolver';
import { invalidarOpenapiIndex } from '../../analyzers/apiEndpointAnalyzer';

function workspaceRootsFromVsCode(): string[] {
  return vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [];
}

function registrarWatcher(
  context: vscode.ExtensionContext,
  basePath: string,
  pattern: string,
  callbacks: {
    onChange?: (uri: vscode.Uri) => void;
    onCreate?: (uri: vscode.Uri) => void;
    onDelete?: (uri: vscode.Uri) => void;
  },
): void {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(basePath, pattern));
  if (callbacks.onChange) {
    context.subscriptions.push(watcher.onDidChange(callbacks.onChange));
  }
  if (callbacks.onCreate) {
    context.subscriptions.push(watcher.onDidCreate(callbacks.onCreate));
  }
  if (callbacks.onDelete) {
    context.subscriptions.push(watcher.onDidDelete(callbacks.onDelete));
  }
  context.subscriptions.push(watcher);
}

function registrarWatchersSchema(context: vscode.ExtensionContext, root: string): void {
  const generatedPath = path.join(root, 'App', 'Config', 'Schema', '_generated');
  if (!fs.existsSync(generatedPath)) {
    return;
  }

  registrarWatcher(context, generatedPath, '*.php', {
    onChange: () => recargarSchema(),
    onCreate: () => recargarSchema(),
    onDelete: () => recargarSchema(),
  });
}

function registrarWatchersIslas(context: vscode.ExtensionContext, root: string): void {
  const appIslandsPath = path.join(root, 'App', 'React', 'appIslands.tsx');
  if (fs.existsSync(appIslandsPath)) {
    registrarWatcher(context, path.dirname(appIslandsPath), 'appIslands.tsx', {
      onChange: () => recargarIslasRegistradas(),
      onCreate: () => recargarIslasRegistradas(),
      onDelete: () => recargarIslasRegistradas(),
    });
  }

  const inicializarPath = path.join(root, 'App', 'React', 'config', 'inicializarIslands.ts');
  if (fs.existsSync(inicializarPath)) {
    registrarWatcher(context, path.dirname(inicializarPath), 'inicializarIslands.ts', {
      onChange: () => recargarIslasRegistradas(),
      onCreate: () => recargarIslasRegistradas(),
      onDelete: () => recargarIslasRegistradas(),
    });
  }
}

function registrarWatchersConstantes(context: vscode.ExtensionContext, root: string): void {
  registrarWatcher(context, root, '{App,Glory/src}/**/*.php', {
    onChange: uri => actualizarArchivoEnIndice(uri.fsPath),
    onCreate: uri => actualizarArchivoEnIndice(uri.fsPath),
    onDelete: () => recargarIndiceConstantes(),
  });

  registrarWatcher(context, root, 'App/Config/Schema/_generated/*.php', {
    onChange: () => recargarIndiceConstantes(),
    onCreate: () => recargarIndiceConstantes(),
    onDelete: () => recargarIndiceConstantes(),
  });
}

function registrarWatchersContratos(context: vscode.ExtensionContext, root: string): void {
  for (const segmentos of RUTAS_CONTROLLERS) {
    const controllerPath = path.join(root, ...segmentos);
    if (!fs.existsSync(controllerPath)) {
      continue;
    }

    registrarWatcher(context, controllerPath, '**/*Controller.php', {
      onChange: () => recargarContratos(),
      onCreate: () => recargarContratos(),
      onDelete: () => recargarContratos(),
    });
  }
}

function registrarWatchersTipos(context: vscode.ExtensionContext, root: string): void {
  const typesPath = path.join(root, 'App', 'React', 'types');
  if (!fs.existsSync(typesPath)) {
    return;
  }

  registrarWatcher(context, typesPath, '*.ts', {
    onChange: () => recargarTipos(),
    onCreate: () => recargarTipos(),
    onDelete: () => recargarTipos(),
  });
}

function registrarWatcherOpenapi(context: vscode.ExtensionContext, root: string): void {
  registrarWatcher(context, root, 'openapi.json', {
    onChange: () => invalidarOpenapiIndex(root),
    onCreate: () => invalidarOpenapiIndex(root),
    onDelete: () => invalidarOpenapiIndex(root),
  });
}

export function inicializarGloryAnalyzerVsCode(context: vscode.ExtensionContext): void {
  const roots = workspaceRootsFromVsCode();
  inicializarGloryAnalyzer(roots);

  for (const root of roots) {
    registrarWatchersSchema(context, root);
    registrarWatchersIslas(context, root);
    registrarWatchersConstantes(context, root);
    registrarWatchersContratos(context, root);
    registrarWatchersTipos(context, root);
    registrarWatcherOpenapi(context, root);
  }
}

/* [105A-2] Los watchers quedan en el adaptador VS Code; los indexadores Glory/API
 * solo reciben rutas y pueden ejecutarse igual desde CLI/LSP. */