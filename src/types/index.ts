import * as vscode from 'vscode';

/* Severidades disponibles para reglas */
export type SeveridadRegla = 'error' | 'warning' | 'information' | 'hint';

/* Tipo de archivo para segmentar reglas */
export type TipoArchivo = 'php' | 'tsx' | 'jsx' | 'ts' | 'js' | 'general';

/* Regla estatica basada en regex */
export interface ReglaEstatica {
  id: string;
  nombre: string;
  descripcion: string;
  patron: RegExp;
  severidad: SeveridadRegla;
  aplicaA: string[];
  categoria: CategoriaRegla;
  /* Mensaje que se muestra al detectar; puede usar $1, $2 para capturas */
  mensaje: string;
  /* Si true, el patron se aplica linea por linea; si false, al archivo completo */
  porLinea: boolean;
  /* ID del quick fix asociado, si existe */
  quickFixId?: string;
}

/* Regla semantica que requiere analisis IA */
export interface ReglaSemantica {
  id: string;
  nombre: string;
  descripcion: string;
  promptResumido: string;
  severidad: SeveridadRegla;
  aplicaA: string[];
  categoria: CategoriaRegla;
}

/* Categorias de reglas segun secciones del protocolo */
export enum CategoriaRegla {
  LimitesArchivo = 'limites-archivo',
  PatronesProhibidos = 'patrones-prohibidos',
  EstructuraNomenclatura = 'estructura-nomenclatura',
  WordPressPhp = 'wordpress-php',
  SeguridadSql = 'seguridad-sql',
  ReactPatrones = 'react-patrones',
  SemanticaIA = 'semantica-ia',
  GlorySchema = 'glory-schema',
}

/* Violacion detectada (formato intermedio antes de convertir a Diagnostic) */
export interface Violacion {
  reglaId: string;
  mensaje: string;
  severidad: SeveridadRegla;
  linea: number;
  lineaFin?: number;
  columna?: number;
  columnaFin?: number;
  sugerencia?: string;
  quickFixId?: string;
  fuente: 'estatico' | 'ia';
}

/* Resultado del analisis IA (lo que devuelve el modelo) */
export interface RespuestaIA {
  violaciones: ViolacionIA[];
}

export interface ViolacionIA {
  linea: number;
  lineaFin?: number;
  regla: string;
  severidad: SeveridadRegla;
  mensaje: string;
  sugerencia?: string;
}

/* Estado de un archivo en cache para el debounce */
export interface EstadoArchivo {
  hash: string;
  ultimoAnalisisEstatico: number;
  ultimoAnalisisIA: number;
  timerEstatico: ReturnType<typeof setTimeout> | null;
  timerIA: ReturnType<typeof setTimeout> | null;
  resultadosEstaticos: vscode.Diagnostic[];
  resultadosIA: vscode.Diagnostic[];
}

/* Configuracion cargada desde settings.json */
export interface ConfiguracionSentinel {
  staticAnalysisEnabled: boolean;
  aiAnalysisEnabled: boolean;
  aiModelFamily: string;
  /* 'copilot' | 'gemini-cli' */
  aiBackend: string;
  geminiModel: string;
  timing: {
    staticDebounceMs: number;
    aiDelayOnOpenMs: number;
    aiDelayOnEditMs: number;
    aiCooldownMs: number;
    aiTimeoutMs: number;
  };
  limits: {
    maxAiRequestsPerMinute: number;
    maxFileSizeForAiKb: number;
  };
  rulesFile: string;
  rulesFiles: string[];
  /* Contenido combinado de los archivos de reglas del usuario (se carga async) */
  customRulesContent: string;
  exclude: string[];
  languages: string[];
}

/* Mapeo de severidad a DiagnosticSeverity de VS Code */
export function severidadADiagnostic(severidad: SeveridadRegla): vscode.DiagnosticSeverity {
  switch (severidad) {
    case 'error': return vscode.DiagnosticSeverity.Error;
    case 'warning': return vscode.DiagnosticSeverity.Warning;
    case 'information': return vscode.DiagnosticSeverity.Information;
    case 'hint': return vscode.DiagnosticSeverity.Hint;
  }
}

/* Determina el TipoArchivo segun el languageId de VS Code */
export function obtenerTipoArchivo(languageId: string, nombreArchivo: string): TipoArchivo {
  switch (languageId) {
    case 'php': return 'php';
    case 'typescriptreact': return 'tsx';
    case 'javascriptreact': return 'jsx';
    case 'typescript': return 'ts';
    case 'javascript': return 'js';
    default: return 'general';
  }
}

/* Verifica si un tipo de archivo coincide con la lista de extensiones de una regla */
export function tipoCoincideConRegla(tipo: TipoArchivo, aplicaA: string[]): boolean {
  if (aplicaA.includes('todos') || aplicaA.includes('all')) {
    return true;
  }

  const mapeo: Record<TipoArchivo, string[]> = {
    php: ['.php'],
    tsx: ['.tsx'],
    jsx: ['.jsx'],
    ts: ['.ts'],
    js: ['.js'],
    general: [],
  };

  const extensiones = mapeo[tipo] || [];
  return aplicaA.some(ext => extensiones.includes(ext));
}
