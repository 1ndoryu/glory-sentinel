/* [274A-12] Analyzer de endpoints API faltantes.
 *
 * Detecta llamadas `apiGet|apiPost|apiPut|apiPatch|apiDelete('path')` en
 * archivos `**\/legacy/services/*.ts` cuyo path resuelto NO existe en el
 * `openapi.json` de la raiz del workspace. Genera diagnostico Warning inline
 * con mensaje `ENDPOINT FALTANTE: METHOD /api/<path>`.
 *
 * Existe para romper el patron reactivo "frontend pega 404 -> usuario reporta
 * -> portar endpoint" (ver tareas 274A-4..274A-10 en glory-rust-template).
 * Es la version inline-en-VSCode del CLI `npm run audit:api` (274A-11);
 * comparten reglas de mapeo de paths.
 *
 * Cache: el openapi.json se carga una vez por workspace root y se invalida
 * desde el adaptador VS Code o al reiniciar el LSP/CLI. La extension NUNCA reinicia VS Code.
 *
 * Limitaciones:
 * - Solo detecta paths estaticos. Calls con template literals (`/foo/${id}`)
 *   se ignoran a proposito (preferimos falsos negativos a positivos).
 * - Solo aplica a `**\/legacy/services/*.ts` (excluye `apiCliente.ts`).
 * - Si no existe `openapi.json` en el workspace, el analyzer no hace nada. */

import * as fs from 'fs';
import * as path from 'path';
import { Violacion } from '../../types';
import { logInfo, logWarn } from '../../utils/logger';
import { CoreApiRutas, CoreTextDocument, CoreWorkspaceContext } from '../../core/runtime-proyecto/types';
import { resolverWorkspaceRoot } from '../../core/seguridad-rutas/workspaceRoots';
import { reglaHabilitada } from '../../config/ruleRegistry';
import { estaGloryActivo } from '../gloryAnalyzer';

/* Defaults de mapeo (replica de wpJsonStub.ts del frontend Kamples). Se usan solo si el
 * sentinel.config.json no declara `apiRutas`; con esa clave, sus valores sustituyen a estos. */
const RUTAS_POR_DEFECTO: Required<CoreApiRutas> = {
  mapa: { '/auth/registro': '/auth/register' },
  mantener: ['/me/bloqueados'],
  prefijosMantener: ['/me/coleccionados', '/me/favoritos', '/me/descargas/sugerencias'],
  prefijosMapa: { '/me': '/users/me', '/perfil': '/users' },
};

/* Orden: mapa exacto, luego "mantener" (exacto y prefijo) y por ultimo los prefijos reescritos. */
function mapPath(legacyPath: string, rutas: CoreApiRutas): string {
  const { mapa = {}, mantener = [], prefijosMantener = [], prefijosMapa = {} } = rutas;
  if (mapa[legacyPath]) return mapa[legacyPath];
  if (mantener.includes(legacyPath)) return legacyPath;
  if (prefijosMantener.some(p => legacyPath === p || legacyPath.startsWith(p + '/'))) return legacyPath;
  for (const [origen, destino] of Object.entries(prefijosMapa)) {
    if (legacyPath === origen || legacyPath.startsWith(origen + '/')) {
      return destino + legacyPath.slice(origen.length);
    }
  }
  return legacyPath;
}

/* --- Index OpenAPI --- */

interface OpenapiEntry {
  regex: RegExp;
  original: string;
}

interface OpenapiIndex {
  byMethod: Map<string, OpenapiEntry[]>;
  pathCount: number;
}

function openapiPathToRegex(p: string): RegExp {
  const stripped = p.startsWith('/api') ? p.slice(4) : p;
  const PLACEHOLDER = '\u0000PARAM\u0000';
  const withPlaceholder = stripped.replace(/\{[^}]+\}/g, PLACEHOLDER);
  const escaped = withPlaceholder.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const restored = escaped.split(PLACEHOLDER).join('[^/]+');
  return new RegExp('^' + restored + '$');
}

/* Forma minima que usa el indice; JSON.parse no garantiza el tipo, asi que solo se declara lo leido. */
interface OpenapiDoc {
  paths?: Record<string, Record<string, unknown>>;
}

function buildOpenapiIndex(openapiJson: OpenapiDoc): OpenapiIndex {
  const byMethod = new Map<string, OpenapiEntry[]>();
  const paths = openapiJson?.paths ?? {};
  let count = 0;
  for (const p of Object.keys(paths)) {
    count += 1;
    const regex = openapiPathToRegex(p);
    for (const method of Object.keys(paths[p] ?? {})) {
      const M = method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(M)) continue;
      if (!byMethod.has(M)) byMethod.set(M, []);
      byMethod.get(M)!.push({ regex, original: p });
    }
  }
  return { byMethod, pathCount: count };
}

/* --- Cache por workspace root --- */

interface WorkspaceCache {
  index: OpenapiIndex | null;
}

const cachePorWorkspace: Map<string, WorkspaceCache> = new Map();

function obtenerIndice(rootPath: string): OpenapiIndex | null {
  const key = rootPath;
  let entry = cachePorWorkspace.get(key);
  if (!entry) {
    entry = { index: null };
    cachePorWorkspace.set(key, entry);
  }

  if (entry.index) return entry.index;

  const openapiPath = path.join(rootPath, 'openapi.json');
  if (!fs.existsSync(openapiPath)) return null;

  try {
    const raw = fs.readFileSync(openapiPath, 'utf8');
    const json = JSON.parse(raw);
    entry.index = buildOpenapiIndex(json);
    return entry.index;
  } catch {
    return null;
  }
}

export function invalidarOpenapiIndex(rootPath?: string): void {
  if (rootPath) {
    cachePorWorkspace.delete(rootPath);
    return;
  }

  cachePorWorkspace.clear();
}

/* --- Extraccion de calls --- */

interface Call {
  method: string;
  legacyPath: string;
  line: number;
  column: number;
}

const CALL_RE = /\bapi(Get|Post|Put|Patch|Delete)\s*<[^>]*>?\s*\(\s*(['"`])([^'"`$\n]+?)\2/g;
const CALL_RE_NO_GENERIC = /\bapi(Get|Post|Put|Patch|Delete)\s*\(\s*(['"`])([^'"`$\n]+?)\2/g;

function extraerCalls(source: string): Call[] {
  const seen = new Set<string>();
  const calls: Call[] = [];

  for (const re of [CALL_RE, CALL_RE_NO_GENERIC]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const method = m[1].toUpperCase();
      const legacyPath = m[3];
      if (!legacyPath.startsWith('/')) continue;
      const key = m.index + ':' + legacyPath;
      if (seen.has(key)) continue;
      seen.add(key);

      const before = source.slice(0, m.index);
      const line = before.split('\n').length;
      const lastNl = before.lastIndexOf('\n');
      const column = m.index - (lastNl + 1) + 1;

      calls.push({ method, legacyPath, line, column });
    }
  }

  return calls;
}

/* --- API publica del analyzer --- */

/* Determina si el archivo aplica para este analyzer */
function archivoAplica(fileName: string): boolean {
  const normalized = fileName.replace(/\\/g, '/');
  if (!normalized.endsWith('.ts')) return false;
  if (!normalized.includes('/legacy/services/')) return false;
  if (normalized.endsWith('/apiCliente.ts')) return false;
  return true;
}

export function analizarApiEndpoints(documento: CoreTextDocument, workspace?: CoreWorkspaceContext): Violacion[] {
  if (!archivoAplica(documento.fileName)) return [];
  /* [SQ-3] openapi.json y services legacy son del framework Glory: sin perfil Glory no aplica. */
  if (!estaGloryActivo()) return [];
  /* Desactivable desde la configuracion de reglas; sin ella no hay nada que comparar. */
  if (!reglaHabilitada('api-endpoint-faltante')) return [];

  const rootPath = resolverWorkspaceRoot(documento.fileName, workspace?.rootPath);
  if (!rootPath) {
    logWarn(`[apiEndpoint] sin workspace root para ${documento.fileName}`);
    return [];
  }

  const indice = obtenerIndice(rootPath);
  if (!indice) {
    logWarn(`[apiEndpoint] no se pudo cargar openapi.json en ${rootPath}`);
    return [];
  }

  const violaciones: Violacion[] = [];
  const calls = extraerCalls(documento.getText());
  const rutas = workspace?.config.apiRutas ?? RUTAS_POR_DEFECTO;
  logInfo(`[apiEndpoint] ${path.basename(documento.fileName)}: ${calls.length} calls escaneados, openapi=${indice.pathCount} paths`);

  for (const call of calls) {
    const mapped = mapPath(call.legacyPath, rutas);
    const candidates = indice.byMethod.get(call.method) || [];
    const matched = candidates.some(c => c.regex.test(mapped));
    if (matched) continue;

    const resolved = '/api' + mapped;
    violaciones.push({
      reglaId: 'api-endpoint-faltante',
      mensaje: `ENDPOINT FALTANTE: ${call.method} ${resolved} (no existe en openapi.json del workspace)`,
      severidad: 'warning',
      linea: Math.max(0, call.line - 1),
      columna: Math.max(0, call.column - 1),
      columnaFin: Math.max(0, call.column - 1) + call.legacyPath.length,
      sugerencia: 'Implementar handler en el backend Rust o eliminar la llamada del frontend.',
      fuente: 'estatico',
    });
  }

  return violaciones;
}
