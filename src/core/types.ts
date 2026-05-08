/* [045A-1] Contratos editor-agnosticos para separar el motor de Sentinel de VS Code.
 * Gotcha: las lineas y columnas son 0-indexed para coincidir con VS Code y LSP. */

export type CoreSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface CorePosition {
  line: number;
  character: number;
}

export interface CoreRange {
  start: CorePosition;
  end: CorePosition;
}

export interface CoreTextLine {
  lineNumber: number;
  text: string;
}

export interface CoreTextDocument {
  uri: string;
  fileName: string;
  languageId: string;
  lineCount: number;
  getText(): string;
  lineAt(line: number): CoreTextLine;
}

export interface CoreFinding {
  ruleId: string;
  message: string;
  severity: CoreSeverity;
  range: CoreRange;
  source: string;
  suggestion?: string;
  quickFixId?: string;
  metadata?: Record<string, unknown>;
}

export interface CoreRuleOverride {
  enabled?: boolean;
  severity?: CoreSeverity;
}

export interface CoreAnalysisConfig {
  enabled: boolean;
  includePatterns: string[];
  excludePatterns: string[];
  ruleOverrides: Record<string, CoreRuleOverride>;
  directoryExceptions?: string[];
  useConfiguredRuleProvider?: boolean;
}

export interface CoreWorkspaceContext {
  rootPath: string;
  config: CoreAnalysisConfig;
}

export interface CreateCoreDocumentInput {
  uri: string;
  fileName: string;
  languageId: string;
  content: string;
}

export function createCoreRange(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): CoreRange {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

export function createCoreDocument(input: CreateCoreDocumentInput): CoreTextDocument {
  const lines = input.content.split(/\r\n|\r|\n/);

  return {
    uri: input.uri,
    fileName: input.fileName,
    languageId: input.languageId,
    lineCount: lines.length,
    getText: () => input.content,
    lineAt: (line: number) => {
      if (line < 0 || line >= lines.length) {
        throw new RangeError(`Line ${line} is outside document bounds`);
      }
      return { lineNumber: line, text: lines[line] };
    },
  };
}

export function positionAtOffset(document: CoreTextDocument, offset: number): CorePosition {
  const text = document.getText();
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, boundedOffset);
  const lines = before.split(/\r\n|\r|\n/);

  return {
    line: lines.length - 1,
    character: lines[lines.length - 1]?.length ?? 0,
  };
}

export function serializeCoreFindings(findings: CoreFinding[]): string {
  return JSON.stringify(findings, null, 2);
}
