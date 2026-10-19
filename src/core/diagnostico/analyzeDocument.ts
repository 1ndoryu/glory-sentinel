import { configurarOverridesReglas, ConfigReglaUsuario } from '../../config/ruleRegistry';
import { Violacion } from '../../types';
import { CoreAnalysisConfig, CoreFinding, CoreTextDocument, CoreWorkspaceContext } from '../runtime-proyecto/types';
import { violacionesToCoreFindings } from './violacionAdapter';

export type CoreExtraAnalyzer = (document: CoreTextDocument) => Violacion[];

/* [S6] El núcleo no importa analyzers: el conjunto de analizadores llega inyectado.
 * La composición por defecto vive en src/analyzers/pipeline.ts (analizarDocumento). */
export interface CoreAnalysisContext {
  config: CoreAnalysisConfig;
  workspace?: CoreWorkspaceContext;
}

export type CoreAnalyzerPipeline = (document: CoreTextDocument, contexto: CoreAnalysisContext) => Violacion[];

export interface AnalyzeDocumentOptions {
  pipeline: CoreAnalyzerPipeline;
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
  workspace: CoreWorkspaceContext | undefined,
  options: AnalyzeDocumentOptions,
): CoreFinding[] {
  if (!config.enabled) {
    return [];
  }

  if (!config.useConfiguredRuleProvider) {
    aplicarOverridesCore(config);
  }

  const violaciones: Violacion[] = [];
  violaciones.push(...options.pipeline(document, { config, workspace }));

  for (const analyzer of options.extraAnalyzers ?? []) {
    violaciones.push(...analyzer(document));
  }

  return violacionesToCoreFindings(violaciones, document);
}
