import { analizarEstatico } from '../analyzers/staticAnalyzer';
import { analizarPhp } from '../analyzers/phpAnalyzer';
import { analizarReact } from '../analyzers/reactAnalyzer';
import { analizarRust } from '../analyzers/rustAnalyzer';
import { analizarGlory } from '../analyzers/gloryAnalyzer';
import { analizarApiEndpoints } from '../analyzers/apiEndpointAnalyzer';
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

/* [085A-1][105A-2] Motor de documento sin dependencia directa de VS Code.
 * Gotcha: las reglas con contexto workspace usan raices inyectadas por CLI/LSP/VS Code antes del analisis. */
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

  violaciones.push(...analizarGlory(document));
  violaciones.push(...analizarApiEndpoints(document, workspace));

  for (const analyzer of options.extraAnalyzers ?? []) {
    violaciones.push(...analyzer(document));
  }

  return violacionesToCoreFindings(violaciones, document);
}