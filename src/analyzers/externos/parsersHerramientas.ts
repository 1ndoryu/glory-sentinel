/* Parsers puros de la salida de ESLint, tsc y cargo clippy: texto → Violacion por archivo.
 * Sin E/S ni vscode: se prueban sin editor. Extraido de externalToolsAnalyzer.ts. */
import * as path from 'path';
import { Violacion, SeveridadRegla } from '../../types';

/*
 * Parsea la salida de ESLint (formato default de eslint).
 * Formato tipico:
 *   /ruta/archivo.ts
 *     10:5  error  Mensaje de error  nombre-regla
 *     20:3  warning  Mensaje de warning  otra-regla
 */
export function parsearSalidaEslint(salida: string, _rutaWorkspace: string): Map<string, Violacion[]> {
  const resultado = new Map<string, Violacion[]>();
  const lineas = salida.split('\n');

  let archivoActual = '';

  for (const linea of lineas) {
    const lineaTrimmed = linea.trim();

    /* Detectar ruta de archivo (empieza con / o C:\ etc) */
    if (/^[A-Za-z]:[\\/]|^\//.test(lineaTrimmed) && !lineaTrimmed.includes('  ')) {
      archivoActual = lineaTrimmed.replace(/\\/g, '/');
      continue;
    }

    /* Parsear linea de error: "10:5  error  Mensaje  regla-id" */
    const matchError = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/.exec(linea);
    if (matchError && archivoActual) {
      const lineaNum = parseInt(matchError[1], 10) - 1;
      const columna = parseInt(matchError[2], 10) - 1;
      const severidad: SeveridadRegla = matchError[3] === 'error' ? 'error' : 'warning';
      const mensaje = matchError[4].trim();
      const reglaEslint = matchError[5] || 'eslint';

      if (!resultado.has(archivoActual)) {
        resultado.set(archivoActual, []);
      }

      resultado.get(archivoActual)!.push({
        reglaId: severidad === 'error' ? 'eslint-error' : 'eslint-warning',
        mensaje: `[ESLint: ${reglaEslint}] ${mensaje}`,
        severidad,
        linea: lineaNum,
        columna,
        fuente: 'estatico',
      });
    }
  }

  return resultado;
}

/*
 * Parsea la salida de tsc (TypeScript compiler).
 * Formato tipico:
 *   archivo.ts(10,5): error TS2345: Argument of type 'string'...
 *   archivo.ts:10:5 - error TS2345: Argument of type 'string'...
 */
export function parsearSalidaTsc(salida: string, rutaBase: string): Map<string, Violacion[]> {
  const resultado = new Map<string, Violacion[]>();
  const lineas = salida.split('\n');

  for (const linea of lineas) {
    /* Formato 1: archivo(linea,col): error TSxxxx: mensaje */
    let match = /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/.exec(linea.trim());

    /* Formato 2: archivo:linea:col - error TSxxxx: mensaje */
    if (!match) {
      match = /^(.+):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s+(.+)$/.exec(linea.trim());
    }

    if (match) {
      let rutaArchivo = match[1].trim();

      /* Resolver ruta relativa a absoluta */
      if (!path.isAbsolute(rutaArchivo)) {
        rutaArchivo = path.join(rutaBase, rutaArchivo);
      }
      rutaArchivo = rutaArchivo.replace(/\\/g, '/');

      const lineaNum = parseInt(match[2], 10) - 1;
      const columna = parseInt(match[3], 10) - 1;
      const codigoTs = match[5];
      const mensaje = match[6].trim();

      if (!resultado.has(rutaArchivo)) {
        resultado.set(rutaArchivo, []);
      }

      resultado.get(rutaArchivo)!.push({
        reglaId: 'tsc-error',
        mensaje: `[TypeScript: ${codigoTs}] ${mensaje}`,
        severidad: 'error',
        linea: lineaNum,
        columna,
        fuente: 'estatico',
      });
    }
  }

  return resultado;
}

/* [124A-SENTINEL1] Parsea salida de cargo clippy --message-format=short.
 * Formato: src/main.rs:10:5: error[E0308]: mismatched types
 *          src/main.rs:10:5: warning: unused variable */
export function parsearSalidaCargo(salida: string, rutaCargo: string): Map<string, Violacion[]> {
  const resultado = new Map<string, Violacion[]>();
  const lineas = salida.split('\n');
  for (const linea of lineas) {
    const match = /^(.+?):(\d+):(\d+):\s+(error|warning)(?:\[.+?\])?:\s+(.+)$/.exec(linea.trim());
    if (!match) { continue; }
    let rutaArchivo = match[1].trim();
    if (!path.isAbsolute(rutaArchivo)) {
      rutaArchivo = path.join(rutaCargo, rutaArchivo);
    }
    rutaArchivo = rutaArchivo.replace(/\\/g, '/');
    const lineaNum = parseInt(match[2], 10) - 1;
    const columna = parseInt(match[3], 10) - 1;
    const severidad: SeveridadRegla = match[4] === 'error' ? 'error' : 'warning';
    const mensaje = match[5].trim();
    if (!resultado.has(rutaArchivo)) { resultado.set(rutaArchivo, []); }
    resultado.get(rutaArchivo)!.push({
      reglaId: severidad === 'error' ? 'cargo-error' : 'cargo-warning',
      mensaje: `[Cargo] ${mensaje}`,
      severidad,
      linea: lineaNum,
      columna,
      fuente: 'estatico',
    });
  }
  return resultado;
}

