import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { esArchivoSoloTest } from '../rustTestScope';
import { REGLA_EXPECT, REGLA_BLOCK, tieneDisableSiguiente, calcularRangosAsync } from './rustReglasCompartidas';

/* ------------------------------------------------------------------ */
/* expect-produccion-rs                                                */
/* ------------------------------------------------------------------ */

/* [039A-1 FP-S3] Constructor de clave HMAC: inalcanzable, no es un panic real.
 *
 * `Hmac<D>` implementa `KeyInit::new_from_slice` devolviendo `Ok` SIEMPRE: HMAC
 * (RFC 2104) normaliza la clave de cualquier longitud (la hashea si excede el
 * bloque, la rellena con ceros si es corta), asi que `InvalidLength` no puede
 * darse. El `.expect(..)` que lo acompania es honesto y correcto.
 *
 * NO se exime `new_from_slice` en general: en AES-GCM/ChaCha20 SI puede fallar
 * por longitud invalida, y ahi el `.expect(..)` es un panic real. Por eso el
 * patron exige un tipo HMAC explicito delante del constructor. */
const RECEPTOR_HMAC = /\b(?:Simple)?Hmac[A-Za-z0-9_]*\b[\s\S]{0,80}?\bnew_from_slice\s*\(/;

/* El `.expect(..)` puede ir en la misma linea que el constructor o en la
 * siguiente (continuacion empezando por `.`), que es como se escribe en el
 * codigo real: por eso se mira hacia atras una vez. */
function caeEnConstructorHmac(lineas: string[], i: number, columna: number): boolean {
  const antes = lineas[i].slice(0, columna);
  if (RECEPTOR_HMAC.test(antes)) { return true; }
  if (antes.trim() !== '' && antes.trim() !== '.') { return false; }

  for (let k = i - 1; k >= 0 && k >= i - 4; k--) {
    const previa = lineas[k].trim();
    if (previa === '' || previa.startsWith('//') || previa.startsWith('*')) { continue; }
    return RECEPTOR_HMAC.test(lineas[k]);
  }
  return false;
}

export function detectarExpect(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, REGLA_EXPECT)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }

  const violaciones: Violacion[] = [];
  const patron = /\.expect\s*\(/g;

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }

    const linea = lineas[i];
    const trimmed = linea.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
    if (tieneDisableSiguiente(lineas, i, REGLA_EXPECT)) { continue; }
    if (linea.includes(`sentinel-disable ${REGLA_EXPECT}`)) { continue; }

    let match: RegExpExecArray | null;
    patron.lastIndex = 0;
    while ((match = patron.exec(linea)) !== null) {
      if (caeEnConstructorHmac(lineas, i, match.index)) { continue; }
      violaciones.push({
        reglaId: REGLA_EXPECT,
        mensaje: '.expect(...) en codigo de produccion: panic si la condicion falla. Usar ? o manejo explicito del error.',
        severidad: obtenerSeveridadRegla(REGLA_EXPECT),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* ------------------------------------------------------------------ */
/* block-en-async-rs                                                   */
/* ------------------------------------------------------------------ */

export function detectarBlockEnAsync(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, REGLA_BLOCK)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }

  const rangosAsync = calcularRangosAsync(lineas);
  const violaciones: Violacion[] = [];
  const patron = /(?:\.|::)block_on\s*\(|futures::executor::block_on\s*\(/g;

  for (let i = 0; i < lineas.length; i++) {
    /* Solo dentro de contexto async y fuera de tests */
    if (!rangosAsync.has(i)) { continue; }
    if (rangoTests.has(i)) { continue; }

    const linea = lineas[i];
    const trimmed = linea.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
    if (tieneDisableSiguiente(lineas, i, REGLA_BLOCK)) { continue; }
    if (linea.includes(`sentinel-disable ${REGLA_BLOCK}`)) { continue; }

    let match: RegExpExecArray | null;
    patron.lastIndex = 0;
    while ((match = patron.exec(linea)) !== null) {
      violaciones.push({
        reglaId: REGLA_BLOCK,
        mensaje: 'block_on() dentro de contexto async: panic "Cannot block the current thread from within a runtime" (caso real tui.rs:281). Reestructurar para await directo.',
        severidad: obtenerSeveridadRegla(REGLA_BLOCK),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
