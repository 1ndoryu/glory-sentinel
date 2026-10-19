import * as fs from 'fs';
import * as path from 'path';
import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { obtenerWorkspaceRoots, resolverWorkspaceRoot } from '../../../core/workspaceRoots';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { esArchivoSoloTest } from '../rustTestScope';
import { REGLA_PORT_FS } from './rustReglasCompartidas';

/* ------------------------------------------------------------------ */
/* [149A-1] port-fs-duplicado-rs (warning, pasada workspace)           */
/* ------------------------------------------------------------------ */

/* Casos reales: persistencia_sqlite duplicado en 2 crates (coolify).
 * Ambito SOLO .rs (frontera con duplicado-cross-crate de varsense, que es
 * solo estilos/tokens). Jaccard >0.8 sobre lineas normalizadas con minimo
 * 20 lineas: debajo de eso, cualquier helper pequeno matchearia.
 * Fail-closed sin workspace roots (patron proyectoTieneModalCanonico).
 * Waiver documentado: linea con 'diverge de' (divergencia intencional).
 * Topes: 30 candidatos, 2000 lineas por candidato, cache por root. */
const UMBRAL_SIMILITUD_FS = 0.8;
const MIN_LINEAS_FS = 20;
const MAX_CANDIDATOS_FS = 30;
const MAX_LINEAS_CANDIDATO_FS = 2000;
const DIRS_EXCLUIDOS_FS = new Set(['target', 'node_modules', '.git', 'tests', 'examples', 'out', 'dist', '.sentinel']);
const cacheCandidatosFs = new Map<string, string[]>();

function conjuntoLineasFs(texto: string): Set<string> {
  const conjunto = new Set<string>();
  for (const linea of texto.split('\n')) {
    const t = linea.trim();
    if (t === '' || t.startsWith('//') || t.startsWith('*')) { continue; }
    conjunto.add(t);
  }
  return conjunto;
}

function jaccardFs(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) { return 0; }
  let interseccion = 0;
  for (const x of a) { if (b.has(x)) { interseccion++; } }
  return interseccion / (a.size + b.size - interseccion);
}

function listarRsWorkspace(root: string): string[] {
  const cached = cacheCandidatosFs.get(root);
  if (cached) { return cached; }

  const resultado: string[] = [];
  const pendientes: string[] = [root];
  while (pendientes.length > 0 && resultado.length < MAX_CANDIDATOS_FS) {
    const dir = pendientes.pop() as string;
    let entradas: import('fs').Dirent[];
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      const ruta = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!DIRS_EXCLUIDOS_FS.has(e.name)) { pendientes.push(ruta); }
      } else if (e.isFile() && e.name.endsWith('.rs')) {
        resultado.push(ruta.replace(/\\/g, '/'));
      }
      if (resultado.length >= MAX_CANDIDATOS_FS) { break; }
    }
  }
  cacheCandidatosFs.set(root, resultado);
  return resultado;
}

export function detectarPortFsDuplicado(
  _lineas: string[],
  _rangoTests: Set<number>,
  texto: string,
  rutaArchivo?: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, REGLA_PORT_FS)) { return []; }
  if (/\bdiverge de\b/i.test(texto)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }
  if (!rutaArchivo) { return []; }

  const roots = obtenerWorkspaceRoots();
  if (roots.length === 0) { return []; }
  const root = resolverWorkspaceRoot(rutaArchivo);
  if (!root) { return []; }

  const propio = rutaArchivo.replace(/\\/g, '/');
  const mias = conjuntoLineasFs(texto);
  if (mias.size < MIN_LINEAS_FS) { return []; }

  const hallazgos: string[] = [];
  /* H11 (harness 2026-09-14): la exclusion del propio fichero se hace AQUI,
   * no en listarRsWorkspace. La cache es por root y se compartia entre
   * ficheros: el segundo fichero analizado se comparaba consigo mismo
   * (similitud 100% con su propia ruta). */
  for (const candidato of listarRsWorkspace(root)) {
    if (candidato === propio) { continue; }
    let contenido: string;
    try {
      contenido = fs.readFileSync(candidato, 'utf8');
    } catch {
      continue;
    }
    if (esArchivoSoloTest(contenido)) { continue; }
    const otras = conjuntoLineasFs(contenido.split('\n').slice(0, MAX_LINEAS_CANDIDATO_FS).join('\n'));
    const sim = jaccardFs(mias, otras);
    if (sim > UMBRAL_SIMILITUD_FS) {
      const rel = path.relative(root, candidato).replace(/\\/g, '/');
      hallazgos.push(`${rel} (${Math.round(sim * 100)}%)`);
      if (hallazgos.length >= 3) { break; }
    }
  }
  if (hallazgos.length === 0) { return []; }

  return [{
    reglaId: REGLA_PORT_FS,
    mensaje: `Contenido duplicado con otro crate del workspace (similitud >80%): ${hallazgos.join('; ')}. Extraer a crate comun o documentar '// diverge de X porque …'.`,
    severidad: obtenerSeveridadRegla(REGLA_PORT_FS),
    linea: 0,
    fuente: 'estatico',
  }];
}
