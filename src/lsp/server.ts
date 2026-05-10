#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyzeDocument } from '../core/analyzeDocument';
import { buildCoreConfig, SentinelConfigFile } from '../core/config';
import { createCoreDocument } from '../core/types';
import { languageIdForFile } from '../core/language';
import { inicializarGloryAnalyzer } from '../analyzers/gloryAnalyzer';
import { invalidarOpenapiIndex } from '../analyzers/apiEndpointAnalyzer';
import { findingToLspDiagnostic } from './diagnostics';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let workspaceRoot: string | undefined;
let initializedWorkspaceRoot: string | undefined;

function fsPathFromUri(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

function workspaceRootFromParams(params: InitializeParams): string | undefined {
  const folderUri = params.workspaceFolders?.[0]?.uri;
  const rootUri = folderUri ?? params.rootUri;

  return rootUri ? fsPathFromUri(rootUri) : undefined;
}

function coreDocumentFromLsp(document: TextDocument) {
  const fileName = fsPathFromUri(document.uri);

  return createCoreDocument({
    uri: document.uri,
    fileName,
    languageId: document.languageId || languageIdForFile(fileName),
    content: document.getText(),
  });
}

function analysisErrorDiagnostic(message: string): Diagnostic {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
    severity: DiagnosticSeverity.Error,
    code: 'lsp-analysis-error',
    source: 'Code Sentinel',
    message: `Code Sentinel LSP analysis failed: ${message}`,
  };
}

async function readConfig(rootPath: string): Promise<SentinelConfigFile> {
  const candidate = path.join(rootPath, 'sentinel.config.json');

  try {
    const raw = await fs.readFile(candidate, 'utf8');
    return JSON.parse(raw) as SentinelConfigFile;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function validateTextDocument(document: TextDocument): Promise<void> {
  const fileName = fsPathFromUri(document.uri);
  const rootPath = workspaceRoot ?? path.dirname(fileName);

  try {
    ensureWorkspaceInitialized(rootPath);
    const config = buildCoreConfig(await readConfig(rootPath));
    const findings = analyzeDocument(
      coreDocumentFromLsp(document),
      config,
      { rootPath, config }
    );

    connection.sendDiagnostics({
      uri: document.uri,
      diagnostics: findings.map(findingToLspDiagnostic),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    connection.console.error(`[Code Sentinel LSP] ${message}`);
    connection.sendDiagnostics({
      uri: document.uri,
      diagnostics: [analysisErrorDiagnostic(message)],
    });
  }
}

function ensureWorkspaceInitialized(rootPath: string): void {
  if (initializedWorkspaceRoot === rootPath) {
    return;
  }

  initializedWorkspaceRoot = rootPath;
  inicializarGloryAnalyzer([rootPath]);
}

function validateAllOpenDocuments(): void {
  for (const document of documents.all()) {
    void validateTextDocument(document);
  }
}

function reloadWorkspaceIndexes(rootPath?: string): void {
  invalidarOpenapiIndex(rootPath);
  if (!rootPath) {
    initializedWorkspaceRoot = undefined;
    return;
  }

  initializedWorkspaceRoot = undefined;
  ensureWorkspaceInitialized(rootPath);
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoot = workspaceRootFromParams(params);

  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      workspace: {
        workspaceFolders: { supported: true },
      },
    },
  };
});

documents.onDidOpen(event => {
  void validateTextDocument(event.document);
});

documents.onDidChangeContent(event => {
  void validateTextDocument(event.document);
});

documents.onDidSave(event => {
  void validateTextDocument(event.document);
});

documents.onDidClose(event => {
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.onDidChangeConfiguration(() => {
  reloadWorkspaceIndexes(workspaceRoot);
  validateAllOpenDocuments();
});

connection.onDidChangeWatchedFiles(() => {
  reloadWorkspaceIndexes(workspaceRoot);
  validateAllOpenDocuments();
});

/* [105A-1][105A-2] LSP fino para publicar diagnostics desde el core de Sentinel.
 * Gotcha: los indices Glory/API se inicializan por workspace root y se recargan al revalidar documentos abiertos. */
documents.listen(connection);
connection.listen();
