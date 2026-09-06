/*
 * [114A-6] Analyzer contextual para Rust.
 * Detecta violaciones SOLID y de seguridad que requieren contexto
 * mas alla de regex por linea: bloques #[cfg(test)], rutas de archivo,
 * conteo de lineas por funcion, conteo de parametros.
 *
 * Reglas implementadas:
 * - unwrap-produccion-rs: .unwrap() fuera de bloques test
 * - panic-produccion-rs: panic!/todo!/unimplemented! fuera de tests
 * - handler-accede-bd-rs: sqlx::query en handlers/ (viola DIP)
 * - funcion-larga-rs: funciones > 100 lineas efectivas
 * - parametros-excesivos-rs: funciones con 6+ parametros
 * - axum-ruta-sintaxis-rs: sintaxis {param}/:param incorrecta para el stack
 *   axum/matchit resuelto (version-aware; legacy ante stack desconocido)
 */

import { Violacion } from '../types';
import { CoreTextDocument } from '../core/types';
import { reglaHabilitada, obtenerSeveridadRegla } from '../config/ruleRegistry';
import * as fs from 'fs';
import * as path from 'path';
import {
  detectarBlockEnAsync,
  detectarExpect,
  detectarLockATravesAwait,
} from './rustReglasNuevas';

/* Limite de lineas efectivas por funcion (clippy tambien lo verifica,
 * pero Sentinel lo muestra inline sin necesidad de compilar) */
const LIMITE_LINEAS_FUNCION = 100;

/* Maximo parametros antes de sugerir agrupar en struct.
 * Ajustado a 8: en Rust, pool: &PgPool siempre es el primer parametro
 * (infraestructura, no diseño) y repos/services tienen multiples campos
 * tipados por operacion. Umbral 5 generaba falsos positivos masivos. */
const LIMITE_PARAMETROS = 8;

/* Ejecuta todas las reglas Rust contextuales sobre un documento .rs */
export function analizarRust(documento: CoreTextDocument): Violacion[] {
  const texto = documento.getText();
  const lineas = texto.split('\n');
  const rutaNorm = documento.fileName.replace(/\\/g, '/');

  /* Excluir archivos de tests dedicados y examples */
  if (rutaNorm.includes('/examples/') || rutaNorm.includes('/tests/')) {
    return [];
  }

  /* Soporte sentinel-disable-file global para todo el analyzer */
  if (texto.includes('sentinel-disable-file rust-analyzer')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  /* Paso 1: Determinar que rangos de lineas son codigo de test.
   * Detecta #[cfg(test)] mod tests { ... } y funciones #[test]. */
  const rangoTests = calcularRangosTest(lineas);

  /* Paso 2: Reglas por linea con contexto test */
  if (reglaHabilitada('unwrap-produccion-rs')) {
    violaciones.push(...detectarUnwrap(lineas, rangoTests, texto));
  }

  if (reglaHabilitada('panic-produccion-rs')) {
    violaciones.push(...detectarPanic(lineas, rangoTests, texto));
  }

  /* Paso 3: Handler accede BD (solo para archivos en handlers/) */
  if (reglaHabilitada('handler-accede-bd-rs') && rutaNorm.includes('/handlers/')) {
    violaciones.push(...detectarHandlerAccedeBd(lineas, texto));
  }

  /* Paso 4: Funciones largas y parametros excesivos */
  if (reglaHabilitada('funcion-larga-rs') || reglaHabilitada('parametros-excesivos-rs')) {
    violaciones.push(...analizarFunciones(lineas, rangoTests, texto));
  }

  /* [096A] Paso 5: broadcast::Mutex — detectar uso de tokio::sync::broadcast
   * broadcast::Sender::send() usa std::sync::Mutex interno. Bajo contencion
   * (multiples sends al mismo canal), bloquea OS threads de tokio workers.
   * Incidente 096A: 15+ caidas, 13 fixes, root cause fue este Mutex. */
  if (reglaHabilitada('broadcast-mutex-riesgo-rs')) {
    violaciones.push(...detectarBroadcastMutex(lineas, rangoTests, texto));
  }

  /* [297A-14] Paso 6: sintaxis de parametros de ruta axum (version-aware:
   * matchit 0.7 (axum 0.7) parsea `:param`; matchit 0.8 (axum 0.8+) parsea
   * `{param}`. Sin evidencia del stack se conserva el comportamiento legacy
   * (flaggear `{param}`: el caso historicamente roto). */
  if (reglaHabilitada('axum-ruta-sintaxis-rs')) {
    violaciones.push(...detectarRutaParametroSintaxis(lineas, texto, documento.fileName));
  }

  /* [059A-S7] Paso 7: reglas nuevas (modulo rustReglasNuevas.ts). */
  if (reglaHabilitada('expect-produccion-rs')) {
    violaciones.push(...detectarExpect(lineas, rangoTests, texto));
  }

  if (reglaHabilitada('block-en-async-rs')) {
    violaciones.push(...detectarBlockEnAsync(lineas, rangoTests, texto));
  }

  if (reglaHabilitada('lock-a-traves-await-rs')) {
    violaciones.push(...detectarLockATravesAwait(lineas, rangoTests, texto));
  }

  return violaciones;
}

/* Calcula rangos de lineas que pertenecen a bloques de test.
 * Detecta #[cfg(test)] seguido de mod, y funciones #[test].
 * Retorna un Set de indices de linea que son "test code". */
function calcularRangosTest(lineas: string[]): Set<number> {
  const rangos = new Set<number>();
  let dentroModTest = false;
  let profundidadLlaves = 0;
  let profundidadInicio = 0;

  for (let i = 0; i < lineas.length; i++) {
    const trimmed = lineas[i].trim();

    /* Detectar inicio de modulo test: #[cfg(test)] */
    if (trimmed === '#[cfg(test)]') {
      /* Marcar la linea del atributo y buscar el mod siguiente */
      rangos.add(i);
      dentroModTest = true;
      profundidadInicio = profundidadLlaves;
      continue;
    }

    if (dentroModTest) {
      rangos.add(i);

      /* Contar llaves para saber cuando termina el modulo */
      for (const ch of lineas[i]) {
        if (ch === '{') { profundidadLlaves++; }
        if (ch === '}') {
          profundidadLlaves--;
          if (profundidadLlaves <= profundidadInicio) {
            dentroModTest = false;
            break;
          }
        }
      }
    } else {
      /* Contar llaves globales para tracking correcto */
      for (const ch of lineas[i]) {
        if (ch === '{') { profundidadLlaves++; }
        if (ch === '}') { profundidadLlaves--; }
      }
    }
  }

  return rangos;
}

/* Detecta .unwrap() fuera de bloques test */
function detectarUnwrap(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes('sentinel-disable-file unwrap-produccion-rs')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const patron = /\.unwrap\(\)/g;

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }

    const linea = lineas[i];
    const trimmed = linea.trim();

    /* Saltar comentarios */
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    /* Saltar lineas con sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line unwrap-produccion-rs')) {
      continue;
    }
    if (linea.includes('sentinel-disable unwrap-produccion-rs')) {
      continue;
    }

    let match: RegExpExecArray | null;
    patron.lastIndex = 0;
    while ((match = patron.exec(linea)) !== null) {
      violaciones.push({
        reglaId: 'unwrap-produccion-rs',
        mensaje: '.unwrap() en codigo de produccion. Usar ? o .unwrap_or() para manejar el error.',
        severidad: obtenerSeveridadRegla('unwrap-produccion-rs'),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* Detecta panic!, todo!, unimplemented! fuera de bloques test */
function detectarPanic(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes('sentinel-disable-file panic-produccion-rs')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const patron = /\b(panic|todo|unimplemented)!\s*\(/g;

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }

    const linea = lineas[i];
    const trimmed = linea.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line panic-produccion-rs')) {
      continue;
    }
    if (linea.includes('sentinel-disable panic-produccion-rs')) {
      continue;
    }

    let match: RegExpExecArray | null;
    patron.lastIndex = 0;
    while ((match = patron.exec(linea)) !== null) {
      const macro = match[1];
      violaciones.push({
        reglaId: 'panic-produccion-rs',
        mensaje: `${macro}!() en codigo de produccion. Retornar error con ? en vez de abortar.`,
        severidad: obtenerSeveridadRegla('panic-produccion-rs'),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* Detecta sqlx::query directo en archivos de handlers/ (viola DIP) */
function detectarHandlerAccedeBd(
  lineas: string[],
  texto: string,
): Violacion[] {
  if (texto.includes('sentinel-disable-file handler-accede-bd-rs')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const patron = /sqlx::query(?:_as|_scalar)?[!]?\s*[(<:]/g;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const trimmed = linea.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line handler-accede-bd-rs')) {
      continue;
    }
    if (linea.includes('sentinel-disable handler-accede-bd-rs')) {
      continue;
    }

    let match: RegExpExecArray | null;
    patron.lastIndex = 0;
    while ((match = patron.exec(linea)) !== null) {
      violaciones.push({
        reglaId: 'handler-accede-bd-rs',
        mensaje: 'Query SQL directa en handler. Mover al repositorio correspondiente (DIP).',
        severidad: obtenerSeveridadRegla('handler-accede-bd-rs'),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* Analiza funciones: longitud y conteo de parametros.
 * Heuristica: busca `fn nombre(` y cuenta llaves hasta cerrar la funcion. */
function analizarFunciones(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  const violaciones: Violacion[] = [];
  const disableFnLarga = texto.includes('sentinel-disable-file funcion-larga-rs');
  const disableParams = texto.includes('sentinel-disable-file parametros-excesivos-rs');

  /* Regex para detectar inicio de funcion Rust (pub/pub(crate)/async etc) */
  const patronFn = /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/;

  let i = 0;
  while (i < lineas.length) {
    const match = patronFn.exec(lineas[i]);
    if (!match) {
      i++;
      continue;
    }

    /* Saltear funciones dentro de bloques test */
    if (rangoTests.has(i)) {
      i++;
      continue;
    }

    const lineaInicio = i;
    const nombreFn = match[2];

    /* Contar parametros: acumular desde ( hasta ) cruzando multiples lineas */
    if (!disableParams && reglaHabilitada('parametros-excesivos-rs')) {
      const numParams = contarParametros(lineas, i);
      if (numParams > LIMITE_PARAMETROS) {
        if (!(i > 0 && lineas[i - 1].includes('sentinel-disable-next-line parametros-excesivos-rs'))) {
          violaciones.push({
            reglaId: 'parametros-excesivos-rs',
            mensaje: `fn ${nombreFn}() tiene ${numParams} parametros (max ${LIMITE_PARAMETROS}). Agrupar en struct.`,
            severidad: obtenerSeveridadRegla('parametros-excesivos-rs'),
            linea: i,
            fuente: 'estatico',
          });
        }
      }
    }

    /* Contar longitud de la funcion: desde la linea fn hasta la } de cierre */
    if (!disableFnLarga && reglaHabilitada('funcion-larga-rs')) {
      const longitud = medirLongitudFuncion(lineas, i);
      if (longitud > LIMITE_LINEAS_FUNCION) {
        if (!(i > 0 && lineas[i - 1].includes('sentinel-disable-next-line funcion-larga-rs'))) {
          violaciones.push({
            reglaId: 'funcion-larga-rs',
            mensaje: `fn ${nombreFn}() tiene ${longitud} lineas efectivas (max ${LIMITE_LINEAS_FUNCION}). Dividir en funciones auxiliares.`,
            severidad: obtenerSeveridadRegla('funcion-larga-rs'),
            linea: lineaInicio,
            fuente: 'estatico',
          });
        }
      }
    }

    i++;
  }

  return violaciones;
}

/* Cuenta parametros de una funcion empezando en la linea donde aparece fn.
 * Acumula texto desde el primer ( hasta el ) correspondiente. */
function contarParametros(lineas: string[], inicio: number): number {
  let texto = '';
  let profundidad = 0;
  let encontroApertura = false;

  for (let i = inicio; i < Math.min(inicio + 30, lineas.length); i++) {
    const linea = lineas[i];

    for (const ch of linea) {
      if (ch === '(') {
        if (!encontroApertura) {
          encontroApertura = true;
          profundidad = 1;
          continue;
        }
        profundidad++;
      } else if (ch === ')') {
        profundidad--;
        if (profundidad === 0 && encontroApertura) {
          return contarComasNivel0(texto);
        }
      }

      if (encontroApertura && profundidad > 0) {
        texto += ch;
      }
    }

    if (encontroApertura) { texto += '\n'; }
  }

  return 0;
}

/* Cuenta parametros separados por comas al nivel 0 de anidamiento.
 * Ignora comas dentro de generics <>, closures |...|, etc. */
function contarComasNivel0(texto: string): number {
  const limpio = texto.trim();
  if (limpio === '' || limpio === '&self' || limpio === '&mut self' || limpio === 'self') {
    return 0;
  }

  let nivel = 0;
  let comas = 0;

  for (const ch of limpio) {
    if (ch === '<' || ch === '(' || ch === '[') { nivel++; }
    if (ch === '>' || ch === ')' || ch === ']') { nivel--; }
    if (ch === ',' && nivel === 0) { comas++; }
  }

  /* N comas = N+1 parametros. Restar self/&self que no cuenta como parametro de negocio */
  let numParams = comas + 1;
  if (/^\s*&?\s*(?:mut\s+)?self/.test(limpio)) {
    numParams--;
  }

  return numParams;
}

/* Mide la longitud efectiva de una funcion (excluyendo lineas vacias y comentarios).
 * Desde la linea fn hasta la } de cierre al mismo nivel de indentacion. */
function medirLongitudFuncion(lineas: string[], inicio: number): number {
  let profundidad = 0;
  let encontroCuerpo = false;
  let lineasEfectivas = 0;
  let enComentarioBloque = false;

  for (let i = inicio; i < lineas.length; i++) {
    const linea = lineas[i];
    const trimmed = linea.trim();

    /* Conteo de llaves */
    for (const ch of linea) {
      if (ch === '{') {
        if (!encontroCuerpo) { encontroCuerpo = true; }
        profundidad++;
      }
      if (ch === '}') {
        profundidad--;
        if (profundidad === 0 && encontroCuerpo) {
          return lineasEfectivas;
        }
      }
    }

    /* No contar la firma como parte del cuerpo */
    if (!encontroCuerpo) { continue; }

    /* Excluir comentarios de bloque */
    if (!enComentarioBloque && trimmed.startsWith('/*')) {
      enComentarioBloque = true;
      if (trimmed.includes('*/') && !trimmed.endsWith('/*')) {
        enComentarioBloque = false;
      }
      continue;
    }
    if (enComentarioBloque) {
      if (trimmed.includes('*/')) { enComentarioBloque = false; }
      continue;
    }

    /* Excluir lineas vacias y comentarios de linea */
    if (trimmed === '' || trimmed.startsWith('//')) { continue; }

    lineasEfectivas++;
  }

  return lineasEfectivas;
}

/* [096A] Detecta uso de tokio::sync::broadcast que usa std::sync::Mutex interno.
 *
 * broadcast::Sender::send() adquiere un Mutex en cada envio. Con multiples
 * sends concurrentes al mismo canal, los tokio workers se bloquean en futex_wait
 * hasta congelar el runtime completo (incidente 096A: 15+ caidas, 13 fixes).
 *
 * Patron prohibido:
 *   use tokio::sync::broadcast;         // import
 *   let (tx, rx) = broadcast::channel(N); // creacion
 *   tx.send(msg);                        // send con Mutex interno
 *
 * Solucion: mpsc::unbounded_channel por suscriptor (lock-free):
 *   use tokio::sync::mpsc;
 *   let (tx, rx) = mpsc::unbounded_channel();  // lock-free
 *   tx.send(msg).ok();                          // nunca bloquea
 */
function detectarBroadcastMutex(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (texto.includes('sentinel-disable-file broadcast-mutex-riesgo-rs')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  /* Patrones a detectar:
   * 1. `use tokio::sync::broadcast` — import del modulo
   * 2. `broadcast::channel(` — creacion de canal
   * 3. `broadcast::Sender` o `broadcast::Receiver` — anotaciones de tipo */
  const patrones: { regex: RegExp; descripcion: string }[] = [
    { regex: /\buse\s+tokio::sync::broadcast\b/, descripcion: 'import de broadcast' },
    { regex: /\bbroadcast::channel\s*[<(]/, descripcion: 'creacion de canal broadcast' },
    { regex: /\bbroadcast::Sender\b/, descripcion: 'tipo broadcast::Sender' },
    { regex: /\bbroadcast::Receiver\b/, descripcion: 'tipo broadcast::Receiver' },
  ];

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }

    const linea = lineas[i];
    const trimmed = linea.trim();

    /* Saltar comentarios */
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    /* Saltar lineas con sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line broadcast-mutex-riesgo-rs')) {
      continue;
    }
    if (linea.includes('sentinel-disable broadcast-mutex-riesgo-rs')) {
      continue;
    }

    for (const patron of patrones) {
      const match = patron.regex.exec(linea);
      if (match) {
        violaciones.push({
          reglaId: 'broadcast-mutex-riesgo-rs',
          mensaje: `tokio::sync::broadcast detectado (${patron.descripcion}). broadcast::Sender::send() usa std::sync::Mutex interno — bloquea tokio workers bajo contencion. Usar mpsc::unbounded_channel por suscriptor (lock-free). Incidente 096A.`,
          severidad: obtenerSeveridadRegla('broadcast-mutex-riesgo-rs'),
          linea: i,
          columna: match.index,
          columnaFin: match.index + match[0].length,
          fuente: 'estatico',
        });
        break; /* Solo una violacion por linea */
      }
    }
  }

  return violaciones;
}

/* [297A-14] Detecta la sintaxis de parametro INCORRECTA dentro de
 * .route("...") de axum, segun el stack resuelto del workspace.
 *
 * - matchit 0.7 (axum 0.7): parsea `:param`; `{id}` se registra como
 *   segmento literal y el endpoint devuelve 404 silencioso (sin error de
 *   compilacion). Caso real 297A-14: rutas `{id}`/`{slug}` rotas.
 * - matchit 0.8 (axum 0.8+): parsea `{param}`; `:id` es el literal roto.
 *   Flaggear `{param}` aqui seria un falso positivo (caso 069A-2: 11 errores
 *   sobre rutas correctas verificadas con 200 en vivo).
 *
 * La version se lee del Cargo.lock subiendo desde el fichero (matchit, y
 * axum como respaldo; Cargo.toml como ultimo recurso). Solo decide con
 * evidencia: sin rastro del stack se conserva el legacy (flaggear `{param}`).
 *
 * Los paths de utoipa (`path = "/api/articles/{id}"`) NO se flaggean:
 * usan {id} por ser templating OpenAPI (docs), no routing.
 *
 * Solucion (stack antiguo): .route("/users/:id", ...) — y dejar {id} solo
 * en utoipa::path. Solucion (stack nuevo): .route("/users/{id}", ...). */
type SintaxisAxum = 'nueva' | 'antigua' | 'desconocida';

interface StackAxum {
  sintaxis: SintaxisAxum;
  matchit: string | null;
  axum: string | null;
}

const cacheStackAxum = new Map<string, StackAxum>();

function versionPaqueteLock(contenido: string, nombre: string): string | null {
  const lineas = contenido.split('\n');
  for (let i = 0; i + 1 < lineas.length; i++) {
    if (lineas[i].trim() === `name = "${nombre}"`) {
      const m = lineas[i + 1].trim().match(/^version = "([^"]+)"/);
      if (m) {
        return m[1];
      }
    }
  }
  return null;
}

function versionAxumToml(contenido: string | null): string | null {
  if (!contenido) {
    return null;
  }
  const m = contenido.match(/^\s*axum\s*=\s*(?:"([^"]+)"|\{\s*version\s*=\s*"([^"]+)")/m);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/* matchit/axum 0.7 vs 0.8 difieren en el MINOR (major 0 en ambos):
 * `nueva` = 0.8+ (o major >= 1 futuro). */
function esSintaxisNueva(version: string | null): boolean | null {
  if (!version) {
    return null;
  }
  const m = version.trim().replace(/^[^\d]*/, '').match(/^(\d+)\.(\d+)/);
  if (!m) {
    return null;
  }
  const mayor = parseInt(m[1], 10);
  const menor = parseInt(m[2], 10);
  return mayor >= 1 || (mayor === 0 && menor >= 8);
}

function stackDesdeLockToml(lock: string | null, toml: string | null): StackAxum | null {
  const matchit = lock ? versionPaqueteLock(lock, 'matchit') : null;
  const axum = (lock ? versionPaqueteLock(lock, 'axum') : null) ?? versionAxumToml(toml);
  const porMatchit = esSintaxisNueva(matchit);
  if (porMatchit !== null) {
    return {
      sintaxis: porMatchit ? 'nueva' : 'antigua',
      matchit,
      axum,
    };
  }
  const porAxum = esSintaxisNueva(axum);
  if (porAxum !== null) {
    return {
      sintaxis: porAxum ? 'nueva' : 'antigua',
      matchit,
      axum,
    };
  }
  return null;
}

function detectarStackAxum(rutaArchivo: string): StackAxum {
  const dirInicio = path.dirname(rutaArchivo.replace(/\\/g, '/'));
  const cached = cacheStackAxum.get(dirInicio);
  if (cached) {
    return cached;
  }
  let resultado: StackAxum = { sintaxis: 'desconocida', matchit: null, axum: null };
  let dir = dirInicio;
  for (let nivel = 0; nivel < 8; nivel++) {
    let lock: string | null = null;
    let toml: string | null = null;
    try {
      const rutaLock = path.join(dir, 'Cargo.lock');
      if (fs.existsSync(rutaLock)) {
        lock = fs.readFileSync(rutaLock, 'utf8');
      }
    } catch {
      /* lock ilegible: se sigue subiendo */
    }
    try {
      const rutaToml = path.join(dir, 'Cargo.toml');
      if (fs.existsSync(rutaToml)) {
        toml = fs.readFileSync(rutaToml, 'utf8');
      }
    } catch {
      /* toml ilegible: se sigue subiendo */
    }
    const stack = stackDesdeLockToml(lock, toml);
    if (stack) {
      resultado = stack;
      break;
    }
    const padre = path.dirname(dir);
    if (padre === dir) {
      break;
    }
    dir = padre;
  }
  cacheStackAxum.set(dirInicio, resultado);
  return resultado;
}

function detectarRutaParametroSintaxis(
  lineas: string[],
  texto: string,
  rutaArchivo: string,
): Violacion[] {
  if (texto.includes('sentinel-disable-file axum-ruta-sintaxis-rs')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  /* Captura la llamada .route( (permite multilinea: .route(\n " ... ")) */
  const patronRuta = /\.route\(\s*"([^"]*)"/g;
  /* Stack resuelto una vez por fichero (con cache por directorio). */
  const stack = detectarStackAxum(rutaArchivo);
  const versionInfo = stack.matchit
    ? `matchit ${stack.matchit}`
    : (stack.axum ? `axum ${stack.axum}` : 'stack desconocido');

  let match: RegExpExecArray | null;
  while ((match = patronRuta.exec(texto)) !== null) {
    const ruta = match[1];

    /* Direccion segun stack: antigua/desconocida flaggea {param} (legacy);
     * nueva flaggea :param (la sintaxis rota en matchit 0.8+). */
    const esRota = stack.sintaxis === 'nueva'
      ? /(^|\/):[a-zA-Z_][a-zA-Z0-9_]*/.test(ruta)
      : /\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(ruta);
    if (!esRota) {
      continue;
    }

    const indiceInicio = match.index;
    const lineaIndex = texto.slice(0, indiceInicio).split('\n').length - 1;
    const ultimoSalto = texto.lastIndexOf('\n', indiceInicio - 1);
    const columnaInicio = indiceInicio - ultimoSalto - 1;
    const linea = lineas[lineaIndex] ?? '';
    const trimmed = linea.trim();

    /* Saltar ejemplos dentro de comentarios */
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    /* Saltar sentinel-disable */
    if (lineaIndex > 0
      && lineas[lineaIndex - 1].includes('sentinel-disable-next-line axum-ruta-sintaxis-rs')) {
      continue;
    }
    if (linea.includes('sentinel-disable axum-ruta-sintaxis-rs')) {
      continue;
    }

    violaciones.push({
      reglaId: 'axum-ruta-sintaxis-rs',
      mensaje: stack.sintaxis === 'nueva'
        ? `Ruta axum con :param: este workspace resuelve ${versionInfo} (axum 0.8+), que solo parsea {param}; :id se registra como literal y devuelve 404 silencioso. Usar {id} en .route().`
        : `Ruta axum con {param}: este workspace resuelve ${versionInfo}, que solo parsea \`:param\`; {id} se registra como literal y devuelve 404 silencioso. Usar :id en .route() (utoipa::path conserva {id} por ser OpenAPI).`,
      severidad: obtenerSeveridadRegla('axum-ruta-sintaxis-rs'),
      linea: lineaIndex,
      columna: columnaInicio,
      columnaFin: columnaInicio + match[0].split('\n')[0].length,
      fuente: 'estatico',
    });
  }

  return violaciones;
}

