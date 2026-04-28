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
 * Cache: el openapi.json se carga una vez por workspaceFolder y se invalida
 * via FileSystemWatcher cuando cambia. La extension NUNCA reinicia VS Code.
 *
 * Limitaciones:
 * - Solo detecta paths estaticos. Calls con template literals (`/foo/${id}`)
 *   se ignoran a proposito (preferimos falsos negativos a positivos).
 * - Solo aplica a `**\/legacy/services/*.ts` (excluye `apiCliente.ts`).
 * - Si no existe `openapi.json` en el workspace, el analyzer no hace nada. */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Violacion } from '../types';

/* --- Reglas de mapeo (replica de wpJsonStub.ts del frontend Kamples) --- */

const PATH_MAP: Record<string, string> = {
  '/auth/registro': '/auth/register',
  '/me': '/users/me',
};

const PATH_MAP_KEEP: Set<string> = new Set([
  '/me/bloqueados',
]);

const PATH_KEEP_PREFIXES: string[] = [
  '/me/coleccionados',
  '/me/favoritos',
  '/me/descargas/sugerencias',
];

function mapPath(legacyPath: string): string {
  if (PATH_MAP[legacyPath]) return PATH_MAP[legacyPath];
  if (PATH_MAP_KEEP.has(legacyPath)) return legacyPath;
  for (const prefix of PATH_KEEP_PREFIXES) {
    if (legacyPath === prefix || legacyPath.startsWith(prefix + '/')) {
      return legacyPath;
    }
  }
  if (legacyPath === '/me' || legacyPath.startsWith('/me/')) {
    return '/users/me' + legacyPath.slice(3);
  }
  if (legacyPath.startsWith('/perfil/')) {
    return '/users/' + legacyPath.slice('/perfil/'.length);
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

function buildOpenapiIndex(openapiJson: any): OpenapiIndex {
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

/* --- Cache por workspaceFolder --- */

interface WorkspaceCache {
  index: OpenapiIndex | null;
  watcher: vscode.FileSystemWatcher | null;
}

const cachePorWorkspace: Map<string, WorkspaceCache> = new Map();

function obtenerIndice(workspaceFolder: vscode.WorkspaceFolder): OpenapiIndex | null {
  const key = workspaceFolder.uri.fsPath;
  let entry = cachePorWorkspace.get(key);
  if (!entry) {
    entry = { index: null, watcher: null };
    cachePorWorkspace.set(key, entry);

    const pattern = new vscode.RelativePattern(workspaceFolder, 'openapi.json');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const invalidar = () => { entry!.index = null; };
    watcher.onDidChange(invalidar);
    watcher.onDidCreate(invalidar);
    watcher.onDidDelete(invalidar);
    entry.watcher = watcher;
  }

  if (entry.index) return entry.index;

  const openapiPath = path.join(workspaceFolder.uri.fsPath, 'openapi.json');
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

export function analizarApiEndpoints(documento: vscode.TextDocument): Violacion[] {
  if (!archivoAplica(documento.fileName)) return [];

  const wsFolder = vscode.workspace.getWorkspaceFolder(documento.uri);
  if (!wsFolder) return [];

  const indice = obtenerIndice(wsFolder);
  if (!indice) return [];

  const violaciones: Violacion[] = [];
  const calls = extraerCalls(documento.getText());

  for (const call of calls) {
    const mapped = mapPath(call.legacyPath);
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
