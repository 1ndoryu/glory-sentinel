/* [S6] Composición por defecto del análisis de documento.
 * Vive fuera de core: el núcleo recibe este conjunto inyectado (CoreAnalyzerPipeline)
 * y no importa analyzers, así que core no depende de los analizadores concretos. */
import { analyzeDocument, AnalyzeDocumentOptions, CoreAnalysisContext } from '../core/analyzeDocument';
import { CoreAnalysisConfig, CoreFinding, CoreTextDocument, CoreWorkspaceContext } from '../core/types';
import { obtenerTipoArchivo, Violacion } from '../types';
import { analizarEstatico } from './staticAnalyzer';
import { analizarPhp } from './phpAnalyzer';
import { analizarReact } from './reactAnalyzer';
import { analizarRust } from './rustAnalyzer';
import { analizarGlory } from './gloryAnalyzer';
import { analizarApiEndpoints } from './apiEndpointAnalyzer';

/* Ejecuta todos los analizadores que aplican al tipo del documento. */
export function pipelineAnalizadores(document: CoreTextDocument, contexto: CoreAnalysisContext): Violacion[] {
  const { config, workspace } = contexto;
  const workspaceRoots = workspace ? [workspace.rootPath] : [];
  const tipo = obtenerTipoArchivo(document.languageId, document.fileName);
  const violaciones: Violacion[] = [];

  violaciones.push(...analizarEstatico(document, undefined, {
    directoryExceptions: config.directoryExceptions ?? [],
    portableBoundaries: config.portableBoundaries,
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
  return violaciones;
}

/* Punto de entrada para CLI, LSP y VS Code: análisis de documento con la composición por defecto. */
export function analizarDocumento(
  document: CoreTextDocument,
  config: CoreAnalysisConfig,
  workspace?: CoreWorkspaceContext,
  options: Omit<AnalyzeDocumentOptions, 'pipeline'> = {},
): CoreFinding[] {
  return analyzeDocument(document, config, workspace, { ...options, pipeline: pipelineAnalizadores });
}
