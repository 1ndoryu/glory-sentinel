/* Reglas Rust (reglas unwrap-produccion-rs y panic-produccion-rs fuera de tests.) Extraído de rustAnalyzer.ts. */
import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { esArchivoSoloTest } from '../rustTestScope';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';

/* Detecta .unwrap() fuera de bloques test */
export function detectarUnwrap(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, 'unwrap-produccion-rs') || esArchivoSoloTest(texto)) {
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
export function detectarPanic(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, 'panic-produccion-rs') || esArchivoSoloTest(texto)) {
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
