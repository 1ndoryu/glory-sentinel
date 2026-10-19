/* Reglas Rust (sintaxis de parámetros de ruta de axum según el stack detectado.) Extraído de rustAnalyzer.ts. */
import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { detectarStackAxum } from '../rustAxumStack';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';

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
 * en utoipa::path. Solucion (stack nuevo): .route("/users/{id}", ...).
 * (Resolucion del stack en `./rustAxumStack`: budget ADR 0001.) */
export function detectarRutaParametroSintaxis(
  lineas: string[],
  texto: string,
  rutaArchivo: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, 'axum-ruta-sintaxis-rs')) {
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
