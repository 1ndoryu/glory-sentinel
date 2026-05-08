import { analizarEstatico } from '../analyzers/staticAnalyzer';
import { analizarPhp } from '../analyzers/phpAnalyzer';
import { analizarReact } from '../analyzers/reactAnalyzer';
import { analizarRust } from '../analyzers/rustAnalyzer';
import { configurarOverridesReglas, ConfigReglaUsuario } from '../config/ruleRegistry';
import { obtenerTipoArchivo, Violacion } from '../types';
import { CoreAnalysisConfig, CoreFinding, CoreTextDocument, CoreWorkspaceContext } from './types';
import { violacionesToCoreFindings } from './violacionAdapter';

export type CoreExtraAnalyzer = (document: CoreTextDocument) => Violacion[];

export interface AnalyzeDocumentOptions {
  extraAnalyzers?: CoreExtraAnalyzer[];
}

function aplicarOverridesCore(config: CoreAnalysisConfig): void {
  const overrides: Record<string, ConfigReglaUsuario> = {};
  for (const [ruleId, override] of Object.entries(config.ruleOverrides)) {
    overrides[ruleId] = {
      habilitada: override.enabled,
      severidad: override.severity,
    };
  }
  configurarOverridesReglas(overrides);
}

/* [085A-1] Motor de documento sin dependencia directa de VS Code.
 * Los analizadores que aun necesitan watchers/workspace se inyectan como extraAnalyzers desde el adaptador. */
export function analyzeDocument(
  document: CoreTextDocument,
  config: CoreAnalysisConfig,
  workspace?: CoreWorkspaceContext,
  options: AnalyzeDocumentOptions = {},
): CoreFinding[] {
  if (!config.enabled) {
    return [];
  }

  if (!config.useConfiguredRuleProvider) {
    aplicarOverridesCore(config);
  }

  const violaciones: Violacion[] = [];
  const workspaceRoots = workspace ? [workspace.rootPath] : [];
  const tipo = obtenerTipoArchivo(document.languageId, document.fileName);

  violaciones.push(...analizarEstatico(document, undefined, {
    directoryExceptions: config.directoryExceptions ?? [],
  }));

  if (tipo === 'php') {
    violaciones.push(...analizarPhp(document));
  } else if (tipo === 'tsx' || tipo === 'jsx') {
    violaciones.push(...analizarReact(document, { workspaceRoots }));
  } else if (tipo === 'rust') {
    violaciones.push(...analizarRust(document));
  }

  for (const analyzer of options.extraAnalyzers ?? []) {
    violaciones.push(...analyzer(document));
  }

  return violacionesToCoreFindings(violaciones, document);
}