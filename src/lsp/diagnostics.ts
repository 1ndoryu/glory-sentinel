import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { CoreFinding, CoreSeverity } from '../core/types';

export function coreSeverityToLspSeverity(severity: CoreSeverity): DiagnosticSeverity {
  switch (severity) {
    case 'error': return DiagnosticSeverity.Error;
    case 'warning': return DiagnosticSeverity.Warning;
    case 'information': return DiagnosticSeverity.Information;
    case 'hint': return DiagnosticSeverity.Hint;
  }
}

export function findingToLspDiagnostic(finding: CoreFinding): Diagnostic {
  return {
    range: finding.range,
    severity: coreSeverityToLspSeverity(finding.severity),
    code: finding.ruleId,
    source: finding.source,
    message: finding.message,
    data: finding.metadata,
  };
}
