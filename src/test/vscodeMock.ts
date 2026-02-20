/*
 * Mock minimo de la API de VS Code para tests unitarios.
 * Permite ejecutar tests de modulos que importan 'vscode'
 * sin necesidad de una instancia real de VS Code.
 *
 * Solo se mockea lo estrictamente necesario para los tests actuales.
 * Agregar nuevos mocks segun crezcan los tests.
 */

export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;

  constructor(startLine: number, startChar: number, endLine: number, endChar: number);
  constructor(start: Position, end: Position);
  constructor(
    startOrLine: Position | number,
    startCharOrEnd: Position | number,
    endLine?: number,
    endChar?: number
  ) {
    if (startOrLine instanceof Position) {
      this.start = startOrLine;
      this.end = startCharOrEnd as Position;
    } else {
      this.start = new Position(startOrLine as number, startCharOrEnd as number);
      this.end = new Position(endLine!, endChar!);
    }
  }
}

/* Espeja DiagnosticSeverity de vscode */
export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const;

export class Diagnostic {
  public source?: string;
  public code?: string | number;
  public relatedInformation?: unknown[];

  constructor(
    public range: Range,
    public message: string,
    public severity: number = DiagnosticSeverity.Warning
  ) {}
}

/* Mock de Uri con toString() funcional */
export const Uri = {
  parse: (value: string) => ({
    toString: () => value,
    fsPath: value.replace('file://', ''),
    scheme: 'file',
  }),
  file: (path: string) => ({
    toString: () => `file://${path.replace(/\\/g, '/')}`,
    fsPath: path,
    scheme: 'file',
  }),
};

/* Mock de workspace.getConfiguration que devuelve valores por defecto */
export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => defaultValue,
    has: (_key: string) => false,
    inspect: (_key: string) => undefined,
    update: async () => {},
  }),
  workspaceFolders: undefined,
  onDidChangeConfiguration: (_listener: unknown) => ({ dispose: () => {} }),
};

export const window = {
  showErrorMessage: (_msg: string) => Promise.resolve(undefined),
  showWarningMessage: (_msg: string) => Promise.resolve(undefined),
  showInformationMessage: (_msg: string) => Promise.resolve(undefined),
  createWebviewPanel: () => ({
    webview: { html: '', onDidReceiveMessage: () => ({ dispose: () => {} }) },
    dispose: () => {},
    onDidDispose: (_cb: () => void) => ({ dispose: () => {} }),
  }),
};

export const languages = {
  createDiagnosticCollection: (_name?: string) => ({
    name: _name || 'test',
    set: () => {},
    delete: () => {},
    clear: () => {},
    dispose: () => {},
    forEach: () => {},
    get: () => undefined,
    has: () => false,
    [Symbol.iterator]: function* () {},
  }),
};

export const commands = {
  registerCommand: (_id: string, _handler: unknown) => ({ dispose: () => {} }),
  executeCommand: async (_id: string, ..._args: unknown[]) => undefined,
};

export const extensions = {
  getExtension: (_id: string) => undefined,
};

export const lm = {
  selectChatModels: async (_opts: unknown) => [],
};

export const ExtensionContext = class {
  subscriptions: { dispose: () => void }[] = [];
  extensionPath = '/mock/extension';
  globalState = { get: () => undefined, update: async () => {} };
  workspaceState = { get: () => undefined, update: async () => {} };
};
