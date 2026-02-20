/*
 * Provider principal de diagnosticos.
 * Coordina el analisis estatico e IA, convierte violaciones
 * a diagnosticos nativos de VS Code y los publica.
 */

import * as vscode from 'vscode';
import { Violacion, severidadADiagnostic, obtenerTipoArchivo, ConfiguracionSentinel } from '../types';
import { analizarEstatico } from '../analyzers/staticAnalyzer';
import { analizarPhp } from '../analyzers/phpAnalyzer';
import { analizarReact } from '../analyzers/reactAnalyzer';
import { analizarCss } from '../analyzers/cssAnalyzer';
import { analizarConIA, invalidarCacheModelo, OpcionesIA } from '../analyzers/aiAnalyzer';
import { guardarEnCache, obtenerDelCache, limpiarCacheCompleto } from '../services/cacheService';
import { logInfo, logWarn } from '../utils/logger';
import {
  programarAnalisisEstatico,
  programarAnalisisIA,
  registrarCallbacks,
  limpiarEstado,
  limpiarTodo,
  actualizarResultados,
} from '../services/debounceService';
import { cargarConfiguracion, debeExcluirse, lenguajeHabilitado, cargarReglasCustom, invalidarCacheReglas } from '../services/ruleLoader';

/* Nombre que aparece en el panel Problems como fuente */
const NOMBRE_FUENTE = 'Code Sentinel';

/* DiagnosticCollection global de la extension */
let coleccionDiagnosticos: vscode.DiagnosticCollection;
let configuracion: ConfiguracionSentinel;

/*
 * Inicializa el provider de diagnosticos.
 * Registra la coleccion, callbacks y listeners de eventos.
 */
export function inicializarDiagnosticProvider(
  context: vscode.ExtensionContext
): vscode.DiagnosticCollection {
  coleccionDiagnosticos = vscode.languages.createDiagnosticCollection('codeSentinel');
  context.subscriptions.push(coleccionDiagnosticos);

  configuracion = cargarConfiguracion();

  /* Cargar reglas custom del usuario desde los archivos configurados */
  cargarReglasCustom(configuracion.rulesFiles).then(contenido => {
    configuracion.customRulesContent = contenido;
    if (contenido.length > 0) {
      logInfo(`Reglas custom inyectadas en prompts IA (${Math.round(contenido.length / 1024)}KB).`);
    }
  });

  /* Registrar callbacks para el servicio de debounce */
  registrarCallbacks(
    (uri) => ejecutarAnalisisEstatico(uri),
    (uri) => ejecutarAnalisisIA(uri)
  );

  /* Listeners de eventos del editor.
   * NOTA: NO usar onDidOpenTextDocument porque VS Code lo dispara para TODOS
   * los documentos que carga en memoria (git, previews, IntelliSense, extensiones),
   * no solo los que el usuario abre visiblemente. Esto causaba analisis innecesarios.
   * En su lugar, usamos onDidChangeVisibleTextEditors para reaccionar solo
   * cuando el usuario realmente ve un archivo. */
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => alCambiarEditoresVisibles(editors)),
    vscode.workspace.onDidChangeTextDocument((e) => alCambiarDocumento(e)),
    vscode.workspace.onDidCloseTextDocument((doc) => alCerrarDocumento(doc)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codeSentinel')) {
        alCambiarConfiguracion();
      }
    })
  );

  /* Analizar solo editores visibles al activar */
  const docsVisibles = vscode.window.visibleTextEditors.map(e => e.document);
  for (const doc of docsVisibles) {
    if (documentoEsValido(doc)) {
      ejecutarAnalisisEstatico(doc.uri);
      programarAnalisisIA(doc.uri, configuracion, configuracion.timing.aiDelayOnOpenMs);
    }
  }

  return coleccionDiagnosticos;
}

/* Ejecuta el analisis estatico completo para un archivo */
function ejecutarAnalisisEstatico(uri: vscode.Uri): void {
  const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (!doc || !documentoEsValido(doc)) {
    return;
  }

  /* Verificar cache */
  const contenido = doc.getText();
  const cacheado = obtenerDelCache(uri, contenido, 'estatico');
  if (cacheado) {
    publicarDiagnosticos(uri, cacheado, 'estatico');
    return;
  }

  /* Ejecutar analisis general */
  const violaciones: Violacion[] = analizarEstatico(doc);

  /* Ejecutar analyzers especializados segun tipo de archivo */
  const tipo = obtenerTipoArchivo(doc.languageId, doc.fileName);

  if (tipo === 'php') {
    violaciones.push(...analizarPhp(doc));
  } else if (tipo === 'tsx' || tipo === 'jsx') {
    violaciones.push(...analizarReact(doc));
  } else if (tipo === 'css') {
    violaciones.push(...analizarCss(doc));
  }

  /* Convertir violaciones a diagnosticos */
  const diagnosticos = violaciones.map(v => crearDiagnostico(doc, v));

  /* Guardar en cache y publicar */
  guardarEnCache(uri, contenido, 'estatico', diagnosticos);
  publicarDiagnosticos(uri, diagnosticos, 'estatico');
}

/* Ejecuta analisis IA para un archivo */
async function ejecutarAnalisisIA(uri: vscode.Uri): Promise<void> {
  const nombreArchivo = uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
  const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());

  if (!doc) {
    logWarn(`IA [${nombreArchivo}]: documento no encontrado en textDocuments.`);
    return;
  }
  if (!documentoEsValido(doc)) {
    logInfo(`IA [${nombreArchivo}]: excluido por validacion (idioma/ruta no habilitado).`);
    return;
  }

  /* Verificar tamano del archivo */
  const contenido = doc.getText();
  const tamanoKb = Math.round(contenido.length / 1024);
  if (contenido.length > configuracion.limits.maxFileSizeForAiKb * 1024) {
    logWarn(`IA [${nombreArchivo}]: archivo demasiado grande (${tamanoKb}KB > ${configuracion.limits.maxFileSizeForAiKb}KB). Omitido.`);
    return;
  }

  /* Verificar cache IA — usar !== null porque [] (sin violaciones) es truthy y causaria falso hit */
  const cacheado = obtenerDelCache(uri, contenido, 'ia');
  if (cacheado !== null) {
    logInfo(`IA [${nombreArchivo}]: resultado en cache, omitiendo request.`);
    publicarDiagnosticos(uri, cacheado, 'ia');
    return;
  }

  const modeloInfo = configuracion.aiBackend === 'gemini-cli'
    ? `Gemini CLI: ${configuracion.geminiModel}`
    : configuracion.aiModelFamily;
  logInfo(`IA [${nombreArchivo}]: iniciando analisis (${tamanoKb}KB, modelo: ${modeloInfo})...`);

  /* Opciones de backend para pasar al analyzer */
  const opcionesGemini: OpcionesIA = {
    aiBackend: configuracion.aiBackend,
    geminiModel: configuracion.geminiModel,
  };

  /* Mostrar indicador de progreso */
  const violacionesIA = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: `Code Sentinel: Analizando ${nombreArchivo}...`,
    },
    async () => {
      return await analizarConIA(
        doc,
        configuracion.aiModelFamily,
        configuracion.timing.aiTimeoutMs,
        undefined,
        configuracion.customRulesContent,
        opcionesGemini
      );
    }
  );

  /* null = la IA fallo (timeout, error de red, modelo no disponible).
   * NO cachear para que se reintente en el proximo ciclo */
  if (violacionesIA === null) {
    logWarn(`IA [${nombreArchivo}]: analisis fallido (no se cachea, se reintentara).`);
    return;
  }

  /* Cachear resultado exitoso (incluso array vacio = sin violaciones) */
  const diagnosticosIA = violacionesIA.map(v => crearDiagnostico(doc, v));
  guardarEnCache(uri, contenido, 'ia', diagnosticosIA);
  if (diagnosticosIA.length > 0) {
    publicarDiagnosticos(uri, diagnosticosIA, 'ia');
  } else {
    logInfo(`IA [${nombreArchivo}]: resultado guardado en cache (0 violaciones).`);
  }
}

/* Crea un diagnostico VS Code a partir de una violacion */
function crearDiagnostico(doc: vscode.TextDocument, violacion: Violacion): vscode.Diagnostic {
  const lineaInicio = Math.max(0, Math.min(violacion.linea, doc.lineCount - 1));
  const lineaFin = violacion.lineaFin !== undefined
    ? Math.max(0, Math.min(violacion.lineaFin, doc.lineCount - 1))
    : lineaInicio;

  /* Si no se especifica columna, comenzar en el primer caracter no-whitespace de la linea.
   * Esto evita que el subrayado incluya la indentacion y apunte al codigo real. */
  const colInicio = violacion.columna ?? Math.max(0, doc.lineAt(lineaInicio).text.search(/\S/));
  const colFin = violacion.columnaFin ?? doc.lineAt(lineaFin).text.length;

  const rango = new vscode.Range(lineaInicio, colInicio, lineaFin, colFin);
  const severidad = severidadADiagnostic(violacion.severidad);

  const diagnostico = new vscode.Diagnostic(rango, violacion.mensaje, severidad);
  diagnostico.source = NOMBRE_FUENTE;
  diagnostico.code = violacion.reglaId;

  if (violacion.sugerencia) {
    diagnostico.message += `\nSugerencia: ${violacion.sugerencia}`;
  }

  return diagnostico;
}

/* Publica diagnosticos, haciendo merge de estaticos e IA sin duplicar */
function publicarDiagnosticos(
  uri: vscode.Uri,
  nuevosDiagnosticos: vscode.Diagnostic[],
  tipo: 'estatico' | 'ia'
): void {
  actualizarResultados(uri, tipo, nuevosDiagnosticos);

  /* Obtener diagnosticos del otro tipo para merge */
  const diagnosticosExistentes = coleccionDiagnosticos.get(uri) || [];
  const otroTipo = tipo === 'estatico' ? 'ia' : 'estatico';

  /* Filtrar los existentes del mismo tipo (seran reemplazados) */
  const delOtroTipo = (diagnosticosExistentes as vscode.Diagnostic[]).filter(d => {
    /* Los diagnosticos IA tienen reglaId que empieza con 'ia-' o no existen en las reglas estaticas */
    if (otroTipo === 'ia') {
      return d.source === NOMBRE_FUENTE && esReglaIA(d.code as string);
    }
    return d.source === NOMBRE_FUENTE && !esReglaIA(d.code as string);
  });

  /* Merge: mantener diagnosticos del otro tipo + nuevos del tipo actual */
  const merged = [...delOtroTipo, ...nuevosDiagnosticos];
  coleccionDiagnosticos.set(uri, merged);
}

/* Heuristico para saber si un diagnostico viene del analisis IA */
function esReglaIA(code: string | undefined): boolean {
  if (!code) { return false; }
  return code.startsWith('ia-') ||
    code === 'separacion-logica-vista' ||
    code === 'srp-violado' ||
    code === 'error-enmascarado' ||
    code === 'update-optimista-sin-rollback';
}

/* Verifica si un documento es valido para analisis */
function documentoEsValido(doc: vscode.TextDocument): boolean {
  /* Excluir esquemas no-archivo */
  if (doc.uri.scheme !== 'file') {
    return false;
  }

  /* Verificar lenguaje habilitado */
  if (!lenguajeHabilitado(doc.languageId, configuracion.languages)) {
    return false;
  }

  /* Verificar exclusiones */
  if (debeExcluirse(doc.fileName, configuracion.exclude)) {
    return false;
  }

  return true;
}

/* Set de URIs de editores que ya fueron analizados, para no repetir al cambiar de tab */
const editoresAnalizados = new Set<string>();

/* Handlers de eventos */

/*
 * Se dispara cuando cambian los editores visibles (el usuario abre un archivo,
 * cambia de tab, split view, etc). Solo analiza documentos NUEVOS que no
 * estaban visibles antes. Reemplaza onDidOpenTextDocument que disparaba
 * para archivos en memoria que el usuario no estaba viendo.
 */
function alCambiarEditoresVisibles(editors: readonly vscode.TextEditor[]): void {
  for (const editor of editors) {
    const doc = editor.document;
    const key = doc.uri.toString();

    if (!documentoEsValido(doc)) {
      continue;
    }

    /* Solo analizar si es un editor nuevo que no hemos visto */
    if (editoresAnalizados.has(key)) {
      continue;
    }
    editoresAnalizados.add(key);

    /* Analisis estatico inmediato */
    ejecutarAnalisisEstatico(doc.uri);

    /* Programar analisis IA con delay corto para archivos visibles */
    if (configuracion.aiAnalysisEnabled) {
      programarAnalisisIA(doc.uri, configuracion, configuracion.timing.aiDelayOnOpenMs);
    }
  }
}

function alCambiarDocumento(event: vscode.TextDocumentChangeEvent): void {
  if (!documentoEsValido(event.document)) {
    return;
  }

  /* Programar analisis estatico con debounce */
  if (configuracion.staticAnalysisEnabled) {
    programarAnalisisEstatico(event.document.uri, configuracion);
  }

  /* Reprogramar analisis IA con delay de edicion */
  if (configuracion.aiAnalysisEnabled) {
    programarAnalisisIA(event.document.uri, configuracion);
  }
}

function alCerrarDocumento(doc: vscode.TextDocument): void {
  limpiarEstado(doc.uri);
  editoresAnalizados.delete(doc.uri.toString());
  coleccionDiagnosticos.delete(doc.uri);
}

function alCambiarConfiguracion(): void {
  configuracion = cargarConfiguracion();
  invalidarCacheModelo();
  invalidarCacheReglas();
  limpiarCacheCompleto();

  /* Recargar reglas custom del usuario */
  cargarReglasCustom(configuracion.rulesFiles).then(contenido => {
    configuracion.customRulesContent = contenido;
  });

  /* Re-analizar documentos abiertos con nueva configuracion */
  for (const doc of vscode.workspace.textDocuments) {
    if (documentoEsValido(doc)) {
      ejecutarAnalisisEstatico(doc.uri);
      /* Re-agendar IA con la nueva configuracion (ej: delay cambiado) */
      if (configuracion.aiAnalysisEnabled) {
        programarAnalisisIA(doc.uri, configuracion, configuracion.timing.aiDelayOnOpenMs);
      }
    }
  }
}

/* Expone funciones para los comandos de la extension */
export function forzarAnalisisArchivo(uri: vscode.Uri): void {
  ejecutarAnalisisEstatico(uri);
  ejecutarAnalisisIA(uri);
}

export async function analizarWorkspace(): Promise<void> {
  /* Construir patron de exclusion desde configuracion (no hardcodeado) */
  const patronExclusion = configuracion.exclude.length > 0
    ? `{${configuracion.exclude.join(',')}}`
    : undefined;

  const archivos = await vscode.workspace.findFiles(
    '**/*.{php,ts,tsx,js,jsx,css}',
    patronExclusion
  );

  /* Mapa para recopilar resultados y generar el reporte */
  const resultadosReporte = new Map<string, { ruta: string; diagnosticos: vscode.Diagnostic[] }>();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Code Sentinel: Analizando workspace...',
      cancellable: true,
    },
    async (progress, token) => {
      for (let i = 0; i < archivos.length; i++) {
        if (token.isCancellationRequested) {
          break;
        }

        progress.report({
          increment: (100 / archivos.length),
          message: `${i + 1}/${archivos.length} archivos`,
        });

        try {
          const doc = await vscode.workspace.openTextDocument(archivos[i]);
          if (documentoEsValido(doc)) {
            /* Solo analisis estatico para scan completo del workspace */
            const violaciones = analizarEstatico(doc);
            const tipo = obtenerTipoArchivo(doc.languageId, doc.fileName);
            if (tipo === 'php') { violaciones.push(...analizarPhp(doc)); }
            else if (tipo === 'tsx' || tipo === 'jsx') { violaciones.push(...analizarReact(doc)); }
            else if (tipo === 'css') { violaciones.push(...analizarCss(doc)); }

            const diagnosticos = violaciones.map(v => crearDiagnostico(doc, v));
            coleccionDiagnosticos.set(archivos[i], diagnosticos);

            /* Solo incluir archivos con violaciones en el reporte */
            if (diagnosticos.length > 0) {
              resultadosReporte.set(archivos[i].fsPath, {
                ruta: archivos[i].fsPath,
                diagnosticos,
              });
            }
          }
        } catch (error) {
          /* Algunos archivos pueden no abrirse (binarios, etc.) */
          logWarn(`No se pudo analizar: ${archivos[i].fsPath} — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  /* Generar archivo de reporte tras el analisis */
  await generarReporteWorkspace(resultadosReporte, archivos.length);
}

/*
 * Genera un archivo markdown con el resumen de todas las violaciones
 * encontradas durante el analisis de workspace.
 */
async function generarReporteWorkspace(
  resultados: Map<string, { ruta: string; diagnosticos: vscode.Diagnostic[] }>,
  totalArchivos: number
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return;
  }

  const config = vscode.workspace.getConfiguration('codeSentinel');
  const reportPath = config.get<string>('reportPath', '.sentinel-report.md');
  const rutaBase = workspaceFolders[0].uri.fsPath.replace(/\\/g, '/');

  /* Contadores por severidad */
  let totalErrores = 0;
  let totalWarnings = 0;
  let totalInfo = 0;
  let totalHints = 0;
  let totalViolaciones = 0;

  for (const [, entrada] of resultados) {
    for (const d of entrada.diagnosticos) {
      totalViolaciones++;
      switch (d.severity) {
        case vscode.DiagnosticSeverity.Error: totalErrores++; break;
        case vscode.DiagnosticSeverity.Warning: totalWarnings++; break;
        case vscode.DiagnosticSeverity.Information: totalInfo++; break;
        case vscode.DiagnosticSeverity.Hint: totalHints++; break;
      }
    }
  }

  const fecha = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let contenido = `# Code Sentinel - Reporte de Workspace\n\n`;
  contenido += `**Fecha:** ${fecha}  \n`;
  contenido += `**Archivos analizados:** ${totalArchivos}  \n`;
  contenido += `**Archivos con violaciones:** ${resultados.size}  \n`;
  contenido += `**Total violaciones:** ${totalViolaciones}  \n\n`;

  contenido += `| Severidad | Cantidad |\n`;
  contenido += `|-----------|----------|\n`;
  contenido += `| Error | ${totalErrores} |\n`;
  contenido += `| Warning | ${totalWarnings} |\n`;
  contenido += `| Info | ${totalInfo} |\n`;
  contenido += `| Hint | ${totalHints} |\n\n`;

  if (totalViolaciones === 0) {
    contenido += `> Sin violaciones detectadas. El workspace esta limpio.\n`;
  }

  /* Ordenar archivos: primero los que tienen mas errores */
  const archivosOrdenados = Array.from(resultados.entries())
    .sort((a, b) => {
      const erroresA = a[1].diagnosticos.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
      const erroresB = b[1].diagnosticos.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
      return erroresB - erroresA || b[1].diagnosticos.length - a[1].diagnosticos.length;
    });

  for (const [, entrada] of archivosOrdenados) {
    /* Ruta relativa al workspace para legibilidad */
    const rutaRelativa = entrada.ruta.replace(/\\/g, '/').replace(rutaBase + '/', '');

    contenido += `---\n\n`;
    contenido += `## ${rutaRelativa} (${entrada.diagnosticos.length} violaciones)\n\n`;
    contenido += `| Linea | Severidad | Regla | Mensaje |\n`;
    contenido += `|-------|-----------|-------|---------|\n`;

    /* Ordenar diagnosticos por linea */
    const diagOrdenados = [...entrada.diagnosticos].sort((a, b) => a.range.start.line - b.range.start.line);

    for (const d of diagOrdenados) {
      const linea = d.range.start.line + 1;
      const severidad = severidadTexto(d.severity);
      const regla = d.code ?? 'general';
      /* Escapar pipes en el mensaje para no romper la tabla markdown */
      const mensaje = d.message.split('\n')[0].replace(/\|/g, '\\|');
      contenido += `| ${linea} | ${severidad} | ${regla} | ${mensaje} |\n`;
    }

    contenido += `\n`;
  }

  /* Escribir archivo y abrirlo */
  try {
    const rutaReporte = vscode.Uri.joinPath(workspaceFolders[0].uri, reportPath);
    await vscode.workspace.fs.writeFile(rutaReporte, Buffer.from(contenido, 'utf-8'));
    const doc = await vscode.workspace.openTextDocument(rutaReporte);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    logInfo(`Reporte generado: ${reportPath} (${totalViolaciones} violaciones en ${resultados.size} archivos).`);
  } catch (error) {
    logWarn(`No se pudo generar reporte: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* Convierte DiagnosticSeverity a texto legible para el reporte */
function severidadTexto(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error: return 'Error';
    case vscode.DiagnosticSeverity.Warning: return 'Warning';
    case vscode.DiagnosticSeverity.Information: return 'Info';
    case vscode.DiagnosticSeverity.Hint: return 'Hint';
    default: return 'Unknown';
  }
}

export function limpiarDiagnosticos(): void {
  coleccionDiagnosticos.clear();
  limpiarTodo();
  limpiarCacheCompleto();
}
