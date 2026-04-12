/*
 * Analyzer que ejecuta herramientas externas (npm run lint, npm run type-check, cargo clippy)
 * y parsea su salida para convertirla en diagnosticos de VS Code.
 *
 * Los errores se publican en la coleccion de diagnosticos y se incluyen
 * en el reporte de workspace.
 * sentinel-disable-file limite-lineas: Archivo central que orquesta 3 herramientas externas
 * (ESLint, TypeScript, Cargo) con sus respectivos parsers. Dividirlo fragmentaria la logica
 * de un flujo cohesivo sin beneficio real. */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { Violacion, SeveridadRegla } from '../types';
import { logInfo, logWarn } from '../utils/logger';

/* Resultado del analisis de herramientas externas */
export interface ResultadoToolsExternas {
  lintViolaciones: Map<string, Violacion[]>;
  typeCheckViolaciones: Map<string, Violacion[]>;
  cargoViolaciones: Map<string, Violacion[]>;
  lintExitoso: boolean;
  typeCheckExitoso: boolean;
  cargoExitoso: boolean;
  resumenLint: string;
  resumenTypeCheck: string;
  resumenCargo: string;
}

/*
 * Ejecuta npm run lint y npm run type-check, parsea la salida
 * y retorna las violaciones agrupadas por archivo.
 */
export async function ejecutarHerramientasExternas(
  onProgress?: (mensaje: string) => void
): Promise<ResultadoToolsExternas> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return resultadoVacio();
  }

  /* Buscar el directorio React donde estan los scripts npm */
  const rutaReact = path.join(workspaceFolders[0].uri.fsPath, 'App', 'React');

  const resultado: ResultadoToolsExternas = {
    lintViolaciones: new Map(),
    typeCheckViolaciones: new Map(),
    cargoViolaciones: new Map(),
    lintExitoso: false,
    typeCheckExitoso: false,
    cargoExitoso: false,
    resumenLint: '',
    resumenTypeCheck: '',
    resumenCargo: '',
  };

  /* Ejecutar lint */
  if (onProgress) { onProgress('Ejecutando npm run lint...'); }
  try {
    const salidaLint = await ejecutarComando('npm run lint 2>&1', rutaReact);
    resultado.lintViolaciones = parsearSalidaEslint(salidaLint, workspaceFolders[0].uri.fsPath);
    resultado.lintExitoso = true;

    let totalLint = 0;
    for (const [, violaciones] of resultado.lintViolaciones) {
      totalLint += violaciones.length;
    }
    resultado.resumenLint = `${totalLint} problema(s) de lint en ${resultado.lintViolaciones.size} archivo(s)`;
    logInfo(`Lint completado: ${resultado.resumenLint}`);
  } catch (error) {
    const errorStr = error instanceof Error ? error.message : String(error);
    /* ESLint retorna exit code 1 cuando encuentra errores, eso es normal */
    if (errorStr.includes('salida:')) {
      const salida = errorStr.substring(errorStr.indexOf('salida:') + 7);
      resultado.lintViolaciones = parsearSalidaEslint(salida, workspaceFolders[0].uri.fsPath);
      resultado.lintExitoso = true;

      let totalLint = 0;
      for (const [, violaciones] of resultado.lintViolaciones) {
        totalLint += violaciones.length;
      }
      resultado.resumenLint = `${totalLint} problema(s) de lint en ${resultado.lintViolaciones.size} archivo(s)`;
      logInfo(`Lint completado (con errores): ${resultado.resumenLint}`);
    } else {
      resultado.resumenLint = `Error ejecutando lint: ${errorStr}`;
      logWarn(resultado.resumenLint);
    }
  }

  /* Ejecutar type-check */
  if (onProgress) { onProgress('Ejecutando npm run type-check...'); }
  try {
    const salidaTypeCheck = await ejecutarComando('npm run type-check 2>&1', rutaReact);
    resultado.typeCheckViolaciones = parsearSalidaTsc(salidaTypeCheck, workspaceFolders[0].uri.fsPath);
    resultado.typeCheckExitoso = true;

    let totalTsc = 0;
    for (const [, violaciones] of resultado.typeCheckViolaciones) {
      totalTsc += violaciones.length;
    }
    resultado.resumenTypeCheck = `${totalTsc} error(es) de tipos en ${resultado.typeCheckViolaciones.size} archivo(s)`;
    logInfo(`Type-check completado: ${resultado.resumenTypeCheck}`);
  } catch (error) {
    const errorStr = error instanceof Error ? error.message : String(error);
    if (errorStr.includes('salida:')) {
      const salida = errorStr.substring(errorStr.indexOf('salida:') + 7);
      resultado.typeCheckViolaciones = parsearSalidaTsc(salida, workspaceFolders[0].uri.fsPath);
      resultado.typeCheckExitoso = true;

      let totalTsc = 0;
      for (const [, violaciones] of resultado.typeCheckViolaciones) {
        totalTsc += violaciones.length;
      }
      resultado.resumenTypeCheck = `${totalTsc} error(es) de tipos en ${resultado.typeCheckViolaciones.size} archivo(s)`;
      logInfo(`Type-check completado (con errores): ${resultado.resumenTypeCheck}`);
    } else {
      resultado.resumenTypeCheck = `Error ejecutando type-check: ${errorStr}`;
      logWarn(resultado.resumenTypeCheck);
    }
  }

  /* [124A-SENTINEL1] Ejecutar cargo clippy si hay Cargo.toml en algun workspace folder */
  const rutaCargo = encontrarRaizCargo(workspaceFolders);
  if (rutaCargo) {
    if (onProgress) { onProgress('Ejecutando cargo clippy...'); }
    try {
      const salidaCargo = await ejecutarComando('cargo clippy --message-format=short -- -D warnings 2>&1', rutaCargo);
      resultado.cargoViolaciones = parsearSalidaCargo(salidaCargo, rutaCargo);
      resultado.cargoExitoso = true;
    } catch (error) {
      const errorStr2 = error instanceof Error ? error.message : String(error);
      if (errorStr2.includes('salida:')) {
        const salida = errorStr2.substring(errorStr2.indexOf('salida:') + 7);
        resultado.cargoViolaciones = parsearSalidaCargo(salida, rutaCargo);
        resultado.cargoExitoso = true;
      } else {
        resultado.resumenCargo = `Error ejecutando cargo clippy: ${errorStr2}`;
        logWarn(resultado.resumenCargo);
      }
    }
    let totalCargo = 0;
    for (const [, violaciones] of resultado.cargoViolaciones) {
      totalCargo += violaciones.length;
    }
    if (!resultado.resumenCargo) {
      resultado.resumenCargo = `${totalCargo} problema(s) de Cargo en ${resultado.cargoViolaciones.size} archivo(s)`;
    }
    logInfo(`Cargo completado: ${resultado.resumenCargo}`);
  } else {
    resultado.resumenCargo = 'No se encontro Cargo.toml';
  }

  return resultado;
}

/*
 * Convierte las violaciones de herramientas externas a diagnosticos de VS Code
 * y los publica en la coleccion proporcionada.
 */
export function publicarDiagnosticosExternos(
  coleccion: vscode.DiagnosticCollection,
  resultado: ResultadoToolsExternas
): number {
  let total = 0;

  const violacionesPorUri = new Map<string, vscode.Diagnostic[]>();

  /* Combinar lint, type-check y cargo */
  const mapas = [resultado.lintViolaciones, resultado.typeCheckViolaciones, resultado.cargoViolaciones];

  for (const mapa of mapas) {
    for (const [rutaArchivo, violaciones] of mapa) {
      const uri = vscode.Uri.file(rutaArchivo);
      const key = uri.toString();

      if (!violacionesPorUri.has(key)) {
        violacionesPorUri.set(key, []);
      }

      const diagnosticos = violacionesPorUri.get(key)!;

      for (const v of violaciones) {
        const linea = Math.max(0, v.linea);
        const col = v.columna ?? 0;
        const rango = new vscode.Range(linea, col, linea, col + 1);

        const severidad = v.severidad === 'error'
          ? vscode.DiagnosticSeverity.Error
          : v.severidad === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information;

        const diagnostic = new vscode.Diagnostic(rango, v.mensaje, severidad);
        diagnostic.source = 'Code Sentinel';
        diagnostic.code = v.reglaId;
        diagnosticos.push(diagnostic);
        total++;
      }
    }
  }

  /* Publicar: hacer merge con diagnosticos existentes de Sentinel */
  for (const [key, nuevosDiags] of violacionesPorUri) {
    const uri = vscode.Uri.parse(key);
    const existentes = (coleccion.get(uri) || []) as vscode.Diagnostic[];
    /* Filtrar diagnosticos externos previos para reemplazarlos */
    const sinExternos = existentes.filter(d =>
      d.code !== 'eslint-error' && d.code !== 'eslint-warning' && d.code !== 'tsc-error' && d.code !== 'cargo-error' && d.code !== 'cargo-warning'
    );
    coleccion.set(uri, [...sinExternos, ...nuevosDiags]);
  }

  return total;
}

/*
 * Genera la seccion del reporte markdown para herramientas externas
 */
export function generarSeccionReporteExterno(resultado: ResultadoToolsExternas, rutaBase: string): string {
  let contenido = `\n---\n\n## Herramientas Externas\n\n`;
  contenido += `**Lint:** ${resultado.resumenLint}  \n`;
  contenido += `**Type-check:** ${resultado.resumenTypeCheck}  \n`;
  contenido += `**Cargo:** ${resultado.resumenCargo}  \n\n`;

  /* Detalle lint */
  if (resultado.lintViolaciones.size > 0) {
    contenido += `### ESLint\n\n`;
    contenido += `| Archivo | Linea | Severidad | Mensaje |\n`;
    contenido += `|---------|-------|-----------|----------|\n`;

    for (const [ruta, violaciones] of resultado.lintViolaciones) {
      const rutaRelativa = ruta.replace(/\\/g, '/').replace(rutaBase.replace(/\\/g, '/') + '/', '');
      for (const v of violaciones) {
        const sev = v.severidad === 'error' ? 'Error' : 'Warning';
        const msg = v.mensaje.replace(/\|/g, '\\|');
        contenido += `| ${rutaRelativa} | ${v.linea + 1} | ${sev} | ${msg} |\n`;
      }
    }
    contenido += `\n`;
  }

  /* Detalle type-check */
  if (resultado.typeCheckViolaciones.size > 0) {
    contenido += `### TypeScript (type-check)\n\n`;
    contenido += `| Archivo | Linea | Mensaje |\n`;
    contenido += `|---------|-------|---------|\n`;

    for (const [ruta, violaciones] of resultado.typeCheckViolaciones) {
      const rutaRelativa = ruta.replace(/\\/g, '/').replace(rutaBase.replace(/\\/g, '/') + '/', '');
      for (const v of violaciones) {
        const msg = v.mensaje.replace(/\|/g, '\\|');
        contenido += `| ${rutaRelativa} | ${v.linea + 1} | ${msg} |\n`;
      }
    }
    contenido += `\n`;
  }

  /* [124A-SENTINEL1] Detalle cargo clippy */
  if (resultado.cargoViolaciones.size > 0) {
    contenido += `### Cargo (clippy)\n\n`;
    contenido += `| Archivo | Linea | Severidad | Mensaje |\n`;
    contenido += `|---------|-------|-----------|----------|\n`;
    for (const [ruta, violaciones] of resultado.cargoViolaciones) {
      const rutaRelativa = ruta.replace(/\\/g, '/').replace(rutaBase.replace(/\\/g, '/') + '/', '');
      for (const v of violaciones) {
        const sev = v.severidad === 'error' ? 'Error' : 'Warning';
        const msg = v.mensaje.replace(/\|/g, '\\|');
        contenido += `| ${rutaRelativa} | ${v.linea + 1} | ${sev} | ${msg} |\n`;
      }
    }
    contenido += `\n`;
  }

  return contenido;
}

/* Ejecuta un comando en un directorio y retorna la salida */
function ejecutarComando(comando: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.exec(comando, { cwd, maxBuffer: 5 * 1024 * 1024, timeout: 120000 }, (error, stdout, stderr) => {
      const salida = stdout + stderr;
      if (error) {
        reject(new Error(`Exit code ${error.code}. salida:${salida}`));
        return;
      }
      resolve(salida);
    });
  });
}

/*
 * Parsea la salida de ESLint (formato default de eslint).
 * Formato tipico:
 *   /ruta/archivo.ts
 *     10:5  error  Mensaje de error  nombre-regla
 *     20:3  warning  Mensaje de warning  otra-regla
 */
function parsearSalidaEslint(salida: string, rutaWorkspace: string): Map<string, Violacion[]> {
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
function parsearSalidaTsc(salida: string, rutaWorkspace: string): Map<string, Violacion[]> {
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
        rutaArchivo = path.join(rutaWorkspace, 'App', 'React', rutaArchivo);
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

/* [124A-SENTINEL1] Busca la raiz del proyecto Rust (workspace folder con Cargo.toml) */
function encontrarRaizCargo(folders: readonly vscode.WorkspaceFolder[]): string | null {
  for (const folder of folders) {
    const cargoPath = path.join(folder.uri.fsPath, 'Cargo.toml');
    try {
      /* fs.existsSync equivalente via vscode no es async, usamos path check */
      const fs = require('fs');
      if (fs.existsSync(cargoPath)) {
        return folder.uri.fsPath;
      }
    } catch { /* ignora */ }
  }
  return null;
}

/* [124A-SENTINEL1] Parsea salida de cargo clippy --message-format=short.
 * Formato: src/main.rs:10:5: error[E0308]: mismatched types
 *          src/main.rs:10:5: warning: unused variable */
function parsearSalidaCargo(salida: string, rutaCargo: string): Map<string, Violacion[]> {
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

/* Retorna un resultado vacio */
function resultadoVacio(): ResultadoToolsExternas {
  return {
    lintViolaciones: new Map(),
    typeCheckViolaciones: new Map(),
    cargoViolaciones: new Map(),
    lintExitoso: false,
    typeCheckExitoso: false,
    cargoExitoso: false,
    resumenLint: 'No se pudo ejecutar',
    resumenTypeCheck: 'No se pudo ejecutar',
    resumenCargo: 'No se pudo ejecutar',
  };
}
