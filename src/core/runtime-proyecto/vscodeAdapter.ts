/* [045A-1] Adaptador fino entre contratos core de Sentinel y la API de VS Code.
 * Pendiente: cuando el core analice documentos directamente, los providers solo deberian usar este modulo. */

import * as vscode from 'vscode';
import { CoreFinding, CoreRange, CoreSeverity, CoreTextDocument, createCoreDocument } from './types';

export function documentFromVsCode(document: vscode.TextDocument): CoreTextDocument {
  return createCoreDocument({
    uri: document.uri.toString(),
    fileName: document.fileName,
    languageId: document.languageId,
    content: document.getText(),
  });
}

export function severityToDiagnosticSeverity(severity: CoreSeverity): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'error': return vscode.DiagnosticSeverity.Error;
    case 'warning': return vscode.DiagnosticSeverity.Warning;
    case 'information': return vscode.DiagnosticSeverity.Information;
    case 'hint': return vscode.DiagnosticSeverity.Hint;
  }
}

export function diagnosticSeverityToSeverity(severity: vscode.DiagnosticSeverity): CoreSeverity {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error: return 'error';
    case vscode.DiagnosticSeverity.Warning: return 'warning';
    case vscode.DiagnosticSeverity.Information: return 'information';
    case vscode.DiagnosticSeverity.Hint: return 'hint';
  }
}

export function rangeToVsCodeRange(range: CoreRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
}

export function findingToDiagnostic(finding: CoreFinding): vscode.Diagnostic {
  const message = finding.suggestion
    ? `${finding.message}\nSugerencia: ${finding.suggestion}`
    : finding.message;
  const diagnostic = new vscode.Diagnostic(
    rangeToVsCodeRange(finding.range),
    message,
    severityToDiagnosticSeverity(finding.severity)
  );
  diagnostic.source = finding.source;
  diagnostic.code = finding.ruleId;
  return diagnostic;
}

export function diagnosticToFinding(diagnostic: vscode.Diagnostic): CoreFinding {
  const code = diagnostic.code;
  const ruleId = typeof code === 'object' && code !== null && 'value' in code
    ? String(code.value)
    : String(code ?? 'general');

  return {
    ruleId,
    message: diagnostic.message,
    severity: diagnosticSeverityToSeverity(diagnostic.severity),
    range: {
      start: {
        line: diagnostic.range.start.line,
        character: diagnostic.range.start.character,
      },
      end: {
        line: diagnostic.range.end.line,
        character: diagnostic.range.end.character,
      },
    },
    source: diagnostic.source ?? 'Code Sentinel',
  };
}
