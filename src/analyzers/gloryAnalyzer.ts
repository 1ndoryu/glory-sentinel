/*
 * Analyzer especializado para el framework Glory.
 * Detecta violaciones del Schema System (Cols/Enums), patrones
 * de acceso a BD en controllers, INTERVAL sin whitelist,
 * open redirect y return void en metodos criticos.
 *
 * Sprint 1 del PLAN_MEJORA_V2.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Violacion } from '../types';
import { reglaHabilitada, obtenerSeveridadRegla } from '../config/ruleRegistry';
import { logInfo, logWarn } from '../utils/logger';

/* =======================================================================
 * TIPOS INTERNOS
 * ======================================================================= */

/* Mapa de tabla -> { clase, columnas } para Cols */
interface MapaCols {
  [tabla: string]: {
    clase: string;
    columnas: Map<string, string>;
    /* valor string -> nombre constante (ej: 'titulo' -> 'TITULO') */
  };
}

/* Mapa de valor enum -> { clase, constante } */
interface EntradaEnum {
  clase: string;
  constante: string;
}

/* =======================================================================
 * CACHE DEL SCHEMA (se carga una vez al activar, se invalida con watcher)
 * ======================================================================= */

let cacheMapaCols: MapaCols | null = null;
let cacheMapaEnums: Map<string, EntradaEnum[]> | null = null;
let schemaWatcher: vscode.FileSystemWatcher | null = null;

/* Cache de islas registradas en appIslands.tsx (Sprint 2.6) */
let cacheIslasRegistradas: Set<string> | null = null;

/* Conjunto de valores enum demasiado comunes para reportar
 * (generarian falsos positivos masivos) */
const VALORES_IGNORADOS_ENUM = new Set([
  'true', 'false', 'null', 'ok', 'error', 'id', 'key', 'type', 'name',
  'value', 'data', 'status', 'message', 'result', 'success', 'fail',
  'yes', 'no', 'on', 'off', '0', '1',
]);

/* Valores de columna que son demasiado genericos para reportar como
 * hardcoded-sql-column (causarian falsos positivos) */
const COLUMNAS_IGNORADAS = new Set([
  'id', 'tipo', 'estado', 'created_at', 'updated_at', 'nombre',
]);

/* =======================================================================
 * CARGA DEL SCHEMA
 * ======================================================================= */

/*
 * Busca la carpeta _generated del Schema en el workspace.
 * Retorna la ruta absoluta o null si no existe.
 */
function buscarCarpetaGenerated(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return null; }

  for (const folder of folders) {
    const ruta = path.join(folder.uri.fsPath, 'App', 'Config', 'Schema', '_generated');
    if (fs.existsSync(ruta)) {
      return ruta;
    }
  }
  return null;
}

/*
 * Parsea un archivo *Cols.php y extrae tabla + columnas.
 * Busca patrones: const TABLA = 'xxx'; y const NOMBRE = 'valor';
 */
function parsearArchivoCols(contenido: string): { tabla: string; clase: string; columnas: Map<string, string> } | null {
  const matchClase = contenido.match(/final\s+class\s+(\w+Cols)/);
  if (!matchClase) { return null; }

  const clase = matchClase[1];

  const matchTabla = contenido.match(/const\s+TABLA\s*=\s*'([^']+)'/);
  if (!matchTabla) { return null; }

  const tabla = matchTabla[1];
  const columnas = new Map<string, string>();

  /* Matchear todas las constantes excepto TABLA y TODAS */
  const regexConst = /const\s+([A-Z_]+)\s*=\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = regexConst.exec(contenido)) !== null) {
    const nombre = match[1];
    const valor = match[2];
    if (nombre !== 'TABLA' && nombre !== 'TODAS') {
      columnas.set(valor, nombre);
    }
  }

  return { tabla, clase, columnas };
}

/*
 * Parsea un archivo *Enums.php y extrae constantes + valores.
 */
function parsearArchivoEnums(contenido: string): { clase: string; constantes: Map<string, string> } | null {
  const matchClase = contenido.match(/final\s+class\s+(\w+Enums)/);
  if (!matchClase) { return null; }

  const clase = matchClase[1];
  const constantes = new Map<string, string>();

  const regexConst = /const\s+([A-Z_]+)\s*=\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = regexConst.exec(contenido)) !== null) {
    constantes.set(match[2], match[1]);
  }

  return { clase, constantes };
}

/*
 * Carga todos los Cols y Enums del directorio _generated.
 * Construye los mapas globales para busquedas rapidas.
 */
function cargarSchema(): void {
  const carpeta = buscarCarpetaGenerated();
  if (!carpeta) {
    logWarn('GloryAnalyzer: No se encontro carpeta _generated del Schema.');
    return;
  }

  const mapaCols: MapaCols = {};
  const mapaEnums = new Map<string, EntradaEnum[]>();

  try {
    const archivos = fs.readdirSync(carpeta);

    for (const archivo of archivos) {
      const rutaCompleta = path.join(carpeta, archivo);
      const contenido = fs.readFileSync(rutaCompleta, 'utf-8');

      if (archivo.endsWith('Cols.php')) {
        const resultado = parsearArchivoCols(contenido);
        if (resultado) {
          mapaCols[resultado.tabla] = {
            clase: resultado.clase,
            columnas: resultado.columnas,
          };
        }
      } else if (archivo.endsWith('Enums.php')) {
        const resultado = parsearArchivoEnums(contenido);
        if (resultado) {
          for (const [valor, constante] of resultado.constantes) {
            if (!mapaEnums.has(valor)) {
              mapaEnums.set(valor, []);
            }
            mapaEnums.get(valor)!.push({
              clase: resultado.clase,
              constante,
            });
          }
        }
      }
    }

    cacheMapaCols = mapaCols;
    cacheMapaEnums = mapaEnums;

    const totalTablas = Object.keys(mapaCols).length;
    const totalEnums = mapaEnums.size;
    logInfo(`GloryAnalyzer: Schema cargado — ${totalTablas} tablas (Cols), ${totalEnums} valores enum.`);
  } catch (err) {
    logWarn(`GloryAnalyzer: Error al cargar schema — ${err}`);
  }
}

/*
 * Inicializa el watcher del schema para invalidar cache
 * cuando se regeneran los archivos _generated.
 * Tambien carga las islas registradas de appIslands.tsx.
 */
export function inicializarGloryAnalyzer(context: vscode.ExtensionContext): void {
  cargarSchema();
  cargarIslasRegistradas();

  /* Watcher para invalidar cache cuando cambian archivos _generated */
  const carpeta = buscarCarpetaGenerated();
  if (carpeta) {
    const patron = new vscode.RelativePattern(carpeta, '*.php');
    schemaWatcher = vscode.workspace.createFileSystemWatcher(patron);

    const recargar = () => {
      logInfo('GloryAnalyzer: Schema _generated cambio, recargando...');
      cacheMapaCols = null;
      cacheMapaEnums = null;
      cargarSchema();
    };

    schemaWatcher.onDidChange(recargar);
    schemaWatcher.onDidCreate(recargar);
    schemaWatcher.onDidDelete(recargar);
    context.subscriptions.push(schemaWatcher);
  }

  /* Watcher para appIslands.tsx e inicializarIslands.ts */
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const folder of folders) {
      const rutaAppIslands = path.join(folder.uri.fsPath, 'App', 'React', 'appIslands.tsx');
      if (fs.existsSync(rutaAppIslands)) {
        const patronIslas = new vscode.RelativePattern(path.dirname(rutaAppIslands), 'appIslands.tsx');
        const islasWatcher = vscode.workspace.createFileSystemWatcher(patronIslas);

        const recargarIslas = () => {
          logInfo('GloryAnalyzer: archivo de islas cambio, recargando...');
          cacheIslasRegistradas = null;
          cargarIslasRegistradas();
        };

        islasWatcher.onDidChange(recargarIslas);
        islasWatcher.onDidCreate(recargarIslas);
        context.subscriptions.push(islasWatcher);

        /* Watcher para config/inicializarIslands.ts (sistema OCP) */
        const rutaInicializar = path.join(folder.uri.fsPath, 'App', 'React', 'config', 'inicializarIslands.ts');
        if (fs.existsSync(rutaInicializar)) {
          const patronInicializar = new vscode.RelativePattern(path.dirname(rutaInicializar), 'inicializarIslands.ts');
          const inicializarWatcher = vscode.workspace.createFileSystemWatcher(patronInicializar);
          inicializarWatcher.onDidChange(recargarIslas);
          inicializarWatcher.onDidCreate(recargarIslas);
          context.subscriptions.push(inicializarWatcher);
        }

        break;
      }
    }
  }
}

/*
 * Carga las islas registradas en appIslands.tsx y config/inicializarIslands.ts.
 * Parsea imports y lazy-imports para construir el set de islas activas.
 * Soporta el sistema OCP donde islands se registran en inicializarIslands.ts
 * y se importan como side-effect desde appIslands.tsx.
 */
function cargarIslasRegistradas(): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return; }

  for (const folder of folders) {
    const rutaApp = path.join(folder.uri.fsPath, 'App', 'React', 'appIslands.tsx');
    if (fs.existsSync(rutaApp)) {
      try {
        cacheIslasRegistradas = new Set<string>();

        /* Parsear appIslands.tsx */
        const contenido = fs.readFileSync(rutaApp, 'utf-8');
        parsearIslasDeContenido(contenido);

        /* Parsear config/inicializarIslands.ts (sistema OCP de auto-registro) */
        const rutaInicializar = path.join(folder.uri.fsPath, 'App', 'React', 'config', 'inicializarIslands.ts');
        if (fs.existsSync(rutaInicializar)) {
          const contenidoInicializar = fs.readFileSync(rutaInicializar, 'utf-8');
          parsearIslasDeContenido(contenidoInicializar);

          /* Parsear llamadas a registrarIsland('NombreIsla', ...) */
          const regexRegistrar = /registrarIsland\s*\(\s*['"](\w+)['"]/g;
          let match: RegExpExecArray | null;
          while ((match = regexRegistrar.exec(contenidoInicializar)) !== null) {
            cacheIslasRegistradas.add(match[1]);
          }
        }

        logInfo(`GloryAnalyzer: ${cacheIslasRegistradas.size} islas registradas en appIslands.tsx + inicializarIslands.ts.`);
      } catch (err) {
        logWarn(`GloryAnalyzer: Error al leer archivos de islas — ${err}`);
      }
      break;
    }
  }
}

/*
 * Parsea imports y registros de islas de un contenido de archivo.
 * Extrae nombres de islas de imports, lazy imports y registros en objetos.
 */
function parsearIslasDeContenido(contenido: string): void {
  if (!cacheIslasRegistradas) { return; }

  /* Imports: import {X} from './islands/X' o './islands/sub/X' */
  const regexImport = /import\s+.*from\s+['"]\.\.?\/islands\/(?:[\w/]+\/)?(\w+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = regexImport.exec(contenido)) !== null) {
    cacheIslasRegistradas.add(match[1]);
  }

  /* Lazy imports: lazy(() => import('./islands/sub/X')) */
  const regexLazy = /import\s*\(\s*['"]\.\.?\/islands\/(?:[\w/]+\/)?(\w+)['"]\s*\)/g;
  while ((match = regexLazy.exec(contenido)) !== null) {
    cacheIslasRegistradas.add(match[1]);
  }

  /* Registros en el objeto appIslands:
   * Con quotes: 'X': component o "X": component
   * Sin quotes: X: component (identifier key) */
  const regexRegistro = /(?:['"](\w+)['"]|(\w+))\s*:\s*\w+/g;
  while ((match = regexRegistro.exec(contenido)) !== null) {
    const nombre = match[1] || match[2];
    if (nombre && /^[A-Z]/.test(nombre)) {
      cacheIslasRegistradas.add(nombre);
    }
  }
}

/* =======================================================================
 * ANALISIS PRINCIPAL
 * ======================================================================= */

/*
 * Punto de entrada del analyzer Glory.
 * Ejecuta verificaciones habilitadas segun tipo de archivo.
 * PHP: schema enforcement, queries, seguridad, calidad.
 * TSX/JSX: isla-no-registrada.
 */
export function analizarGlory(documento: vscode.TextDocument): Violacion[] {
  const texto = documento.getText();
  const lineas = texto.split('\n');
  const rutaArchivo = documento.fileName;
  const violaciones: Violacion[] = [];

  /* Excluir archivos auto-generados y prototipos de referencia */
  const rutaNormalizada = rutaArchivo.replace(/\\/g, '/');
  if (rutaNormalizada.includes('_generated/') || rutaNormalizada.includes('_generated\\')) {
    return [];
  }
  const nombreBase = path.basename(rutaArchivo, path.extname(rutaArchivo));
  if (nombreBase === 'ejemplo' || nombreBase === 'example') {
    return [];
  }

  const extension = path.extname(rutaArchivo).toLowerCase();

  /* --- Reglas TSX/JSX --- */
  if (extension === '.tsx' || extension === '.jsx') {
    if (reglaHabilitada('isla-no-registrada')) {
      violaciones.push(...verificarIslaNoRegistrada(rutaNormalizada, texto));
    }
    return violaciones;
  }

  /* --- Reglas PHP --- */
  if (extension !== '.php') { return violaciones; }

  /* Asegurar que el schema este cargado */
  if (!cacheMapaCols && !cacheMapaEnums) {
    cargarSchema();
  }

  /* Sprint 1 */
  if (reglaHabilitada('hardcoded-sql-column') && cacheMapaCols) {
    violaciones.push(...verificarHardcodedSqlColumn(lineas, rutaNormalizada));
  }

  if (reglaHabilitada('hardcoded-enum-value') && cacheMapaEnums) {
    violaciones.push(...verificarHardcodedEnumValue(lineas, rutaNormalizada));
  }

  if (reglaHabilitada('endpoint-accede-bd')) {
    violaciones.push(...verificarEndpointAccedeBd(lineas, rutaNormalizada));
  }

  if (reglaHabilitada('interval-sin-whitelist')) {
    violaciones.push(...verificarIntervalSinWhitelist(lineas));
  }

  if (reglaHabilitada('open-redirect')) {
    violaciones.push(...verificarOpenRedirect(lineas));
  }

  /* Glory/ es framework externo con su propia arquitectura — las reglas
   * return-void-critico y controller-fqn-inline no aplican a su codigo. */
  if (reglaHabilitada('return-void-critico') && !rutaNormalizada.includes('/Glory/')) {
    violaciones.push(...verificarReturnVoidCritico(texto, lineas));
  }

  /* Sprint 3 */
  if (reglaHabilitada('n-plus-1-query')) {
    violaciones.push(...verificarNPlus1Query(lineas, rutaNormalizada));
  }

  if (reglaHabilitada('controller-fqn-inline') && !rutaNormalizada.includes('/Glory/')) {
    violaciones.push(...verificarFqnInline(lineas));
  }

  if (reglaHabilitada('php-sin-return-type')) {
    violaciones.push(...verificarPhpSinReturnType(lineas));
  }

  if (reglaHabilitada('repository-sin-whitelist-columnas')) {
    violaciones.push(...verificarSelectStar(lineas, rutaNormalizada));
  }

  return violaciones;
}

/* =======================================================================
 * 1.1 HARDCODED SQL COLUMN
 * Detecta strings literales de nombres de columna en contexto SQL
 * que deberian usar constantes Cols.
 * ======================================================================= */

/*
 * Detecta si una linea tiene contexto SQL cercano,
 * luego busca strings literales que coincidan con columnas conocidas.
 */
function verificarHardcodedSqlColumn(lineas: string[], rutaArchivo: string): Violacion[] {
  const violaciones: Violacion[] = [];
  if (!cacheMapaCols) { return violaciones; }

  /* Excluir archivos de migraciones, seeders y el propio schema.
   * Los seeders son datos de inicializacion — sus arrays PHP de datos
   * no son contexto SQL aunque usen la misma sintaxis de claves.
   * Excluir archivos del framework Glory/ — el schema solo cubre tablas
   * del modulo App (cap_*), las tablas glory_* son independientes.
   * Excluir Config/ — archivos de configuracion usan claves como 'email'
   * en arrays PHP de props/settings, no en contexto SQL. */
  if (rutaArchivo.includes('/migrations/') || rutaArchivo.includes('/Schema/') ||
      rutaArchivo.includes('Seeder') || rutaArchivo.includes('/seeders/') ||
      rutaArchivo.includes('/Glory/') || rutaArchivo.includes('/Config/')) {
    return violaciones;
  }

  /* Construir set plano de todas las columnas conocidas para lookup rapido */
  const todasLasColumnas = new Map<string, { tabla: string; clase: string; constante: string }>();
  for (const [tabla, info] of Object.entries(cacheMapaCols)) {
    for (const [valor, constante] of info.columnas) {
      if (!COLUMNAS_IGNORADAS.has(valor)) {
        todasLasColumnas.set(valor, { tabla, clase: info.clase, constante });
      }
    }
  }

  /* Regex para detectar contexto SQL en la linea o lineas cercanas */
  const regexContextoSql = /\b(SELECT|INSERT|UPDATE|DELETE|WHERE|ORDER\s+BY|GROUP\s+BY|JOIN|SET|HAVING|FROM|INTO|VALUES)\b/i;

  /* Regex para extraer strings entrecomillados simples en contextos SQL */
  const regexStringEnSql = /['"]([a-z_]{2,})['"](?:\s*(?:=|<|>|!=|<>|IS|IN|LIKE|ASC|DESC|,|\)|\.|\s))/gi;

  /* Ventana de contexto: una linea SQL afecta a las 3 lineas siguientes
   * (queries multi-linea concatenadas con .) */
  const VENTANA_CONTEXTO = 4;
  const lineasConContextoSql = new Set<number>();

  for (let i = 0; i < lineas.length; i++) {
    if (regexContextoSql.test(lineas[i])) {
      for (let j = Math.max(0, i - 1); j < Math.min(lineas.length, i + VENTANA_CONTEXTO); j++) {
        lineasConContextoSql.add(j);
      }
    }
  }

  /* Detectar lineas cerca de operaciones $wpdb de escritura.
   * $wpdb->insert/update/delete/replace usan arrays asociativos
   * ['columna' => valor] donde SI son contexto SQL.
   * Sin este filtro, cualquier array PHP con claves como 'fecha', 'email'
   * se detecta como SQL hardcodeado (ej: arrays de respuesta API,
   * estructuras de datos internas, metadatos Stripe). */
  const regexWpdbWrite = /\$wpdb->(?:insert|update|delete|replace)\s*\(/;
  const VENTANA_WRITE = 8;
  const lineasConContextoWrite = new Set<number>();

  for (let i = 0; i < lineas.length; i++) {
    if (regexWpdbWrite.test(lineas[i])) {
      for (let j = Math.max(0, i); j < Math.min(lineas.length, i + VENTANA_WRITE); j++) {
        lineasConContextoWrite.add(j);
      }
    }
  }

  /* Tambien detectar contexto de arrays asociativos en inserts/updates:
   * 'columna' => $valor o 'columna' => 'valor' */
  const regexArrayAsociativo = /['"]([a-z_]{2,})['"]\s*=>/g;

  /* Detectar arrays planos de whitelists de columnas:
   * $permitidos = ['nombre', 'email', 'telefono'] */
  const regexContextoWhitelist = /\$(permitidos|permitidas|allowed|campos|columnas|whitelist|fields|ordenables|filtrables)\b/i;
  const regexValorArrayPlano = /['"]([a-z_]{2,})['"](?:\s*,|\s*\])/g;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaTrimmed = linea.trim();

    /* Saltar comentarios y docblocks */
    if (lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/**') ||
        lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('#') ||
        lineaTrimmed.startsWith('/*')) {
      continue;
    }

    /* Saltar lineas con sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line hardcoded-sql-column')) {
      continue;
    }
    if (linea.includes('sentinel-disable hardcoded-sql-column')) {
      continue;
    }

    /* Saltar si la linea ya usa constantes Cols */
    if (/\w+Cols::/.test(linea)) {
      continue;
    }

    /* Verificar strings en contexto SQL */
    if (lineasConContextoSql.has(i)) {
      regexStringEnSql.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regexStringEnSql.exec(linea)) !== null) {
        const valor = match[1];

        /* Excluir parametros PDO (:nombre) */
        const charAnterior = linea[match.index - 1];
        if (charAnterior === ':') {
          continue;
        }

        /* Excluir aliases SQL (AS nombre) */
        const contextoPrevio = linea.substring(Math.max(0, match.index - 5), match.index).trim();
        if (/\bAS\s*$/i.test(contextoPrevio)) {
          continue;
        }

        const info = todasLasColumnas.get(valor);
        if (info) {
          violaciones.push({
            reglaId: 'hardcoded-sql-column',
            mensaje: `'${valor}' deberia usar ${info.clase}::${info.constante} (tabla: ${info.tabla})`,
            severidad: obtenerSeveridadRegla('hardcoded-sql-column'),
            linea: i,
            columna: match.index,
            columnaFin: match.index + match[0].length,
            sugerencia: `Reemplazar '${valor}' con ${info.clase}::${info.constante}`,
            fuente: 'estatico',
          });
        }
      }
    }

    /* Verificar arrays asociativos (inserts/updates).
     * Solo flag si la linea esta en contexto SQL o cerca de $wpdb write.
     * Sin este guard, arrays de respuesta API, datos internos y metadatos
     * Stripe se detectan como SQL hardcodeado (falsos positivos masivos). */
    if (lineasConContextoSql.has(i) || lineasConContextoWrite.has(i)) {
      regexArrayAsociativo.lastIndex = 0;
      let matchArr: RegExpExecArray | null;
      while ((matchArr = regexArrayAsociativo.exec(linea)) !== null) {
        const valor = matchArr[1];
        const info = todasLasColumnas.get(valor);
        if (info) {
          /* Verificar que no es una linea ya usando Cols */
          if (!/\w+Cols::/.test(linea)) {
            violaciones.push({
              reglaId: 'hardcoded-sql-column',
              mensaje: `'${valor}' deberia usar ${info.clase}::${info.constante} (tabla: ${info.tabla})`,
              severidad: obtenerSeveridadRegla('hardcoded-sql-column'),
              linea: i,
              columna: matchArr.index,
              columnaFin: matchArr.index + matchArr[0].length,
              sugerencia: `Reemplazar '${valor}' con ${info.clase}::${info.constante}`,
              fuente: 'estatico',
            });
          }
        }
      }
    }

    /* Verificar arrays planos de whitelists de columnas.
     * Solo activo si la linea actual o las 2 anteriores contienen
     * una variable de nombre sugerente ($permitidos, $campos, etc.) */
    const tieneContextoWhitelist =
      regexContextoWhitelist.test(linea) ||
      (i > 0 && regexContextoWhitelist.test(lineas[i - 1])) ||
      (i > 1 && regexContextoWhitelist.test(lineas[i - 2]));

    if (tieneContextoWhitelist && !/\w+Cols::/.test(linea)) {
      regexValorArrayPlano.lastIndex = 0;
      let matchPlano: RegExpExecArray | null;
      while ((matchPlano = regexValorArrayPlano.exec(linea)) !== null) {
        const valor = matchPlano[1];
        const info = todasLasColumnas.get(valor);
        if (info) {
          violaciones.push({
            reglaId: 'hardcoded-sql-column',
            mensaje: `'${valor}' en whitelist deberia usar ${info.clase}::${info.constante} (tabla: ${info.tabla})`,
            severidad: obtenerSeveridadRegla('hardcoded-sql-column'),
            linea: i,
            columna: matchPlano.index,
            columnaFin: matchPlano.index + matchPlano[0].length,
            sugerencia: `Reemplazar '${valor}' con ${info.clase}::${info.constante}`,
            fuente: 'estatico',
          });
        }
      }
    }
  }

  return violaciones;
}

/* =======================================================================
 * 1.2 HARDCODED ENUM VALUE
 * Detecta strings literales que coinciden con valores de Enums
 * en contexto de comparaciones o asignaciones.
 * ======================================================================= */

function verificarHardcodedEnumValue(lineas: string[], rutaArchivo: string): Violacion[] {
  const violaciones: Violacion[] = [];
  if (!cacheMapaEnums) { return violaciones; }

  /* Excluir archivos de Enums/Schema propios */
  if (rutaArchivo.includes('Enums.php') || rutaArchivo.includes('Schema.php') ||
      rutaArchivo.includes('_generated/')) {
    return violaciones;
  }

  /* Excluir Glory/ — framework externo con convenciones propias */
  if (rutaArchivo.includes('/Glory/')) {
    return violaciones;
  }

  /* Regex para detectar strings en comparaciones y asignaciones:
   * === 'valor', == 'valor', !== 'valor', = 'valor', != 'valor'
   * Tambien: case 'valor': */
  const regexComparacion = /(?:===?|!==?|<>)\s*'([^']+)'/g;
  const regexAsignacion = /(?:\$\w+(?:->\w+)*\s*=\s*)'([^']+)'/g;
  const regexCase = /\bcase\s+'([^']+)'/g;
  /* Contexto SQL: WHERE ... = 'valor' (el valor, no la columna) */
  const regexSqlValor = /(?:WHERE|AND|OR|SET)\s+\w+\s*=\s*'([^']+)'/gi;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaTrimmed = linea.trim();

    /* Saltar comentarios */
    if (lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/**') ||
        lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('#') ||
        lineaTrimmed.startsWith('/*')) {
      continue;
    }

    /* Saltar lineas con sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line hardcoded-enum-value')) {
      continue;
    }
    if (linea.includes('sentinel-disable hardcoded-enum-value')) {
      continue;
    }

    /* Saltar si la linea ya usa constantes Enums */
    if (/\w+Enums::/.test(linea)) {
      continue;
    }

    /* Detectar en contextos de log/error para excluir */
    const esLineaLog = /\b(log_error|error_log|logInfo|logWarn|logError|throw|WP_Error|trigger_error|Logger::)\b/i.test(linea);

    const buscarEnRegex = (regex: RegExp) => {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(linea)) !== null) {
        const valor = match[1];

        /* Excluir valores ignorados */
        if (VALORES_IGNORADOS_ENUM.has(valor.toLowerCase())) {
          continue;
        }

        /* Excluir si es contexto de log/error */
        if (esLineaLog) {
          continue;
        }

        const entradas = cacheMapaEnums!.get(valor);
        if (entradas && entradas.length > 0) {
          /* Usar la primera coincidencia (puede haber multiples enums con el mismo valor) */
          const entrada = entradas[0];
          const sugerenciaMultiple = entradas.length > 1
            ? ` (tambien en: ${entradas.slice(1).map(e => e.clase).join(', ')})`
            : '';

          violaciones.push({
            reglaId: 'hardcoded-enum-value',
            mensaje: `'${valor}' deberia usar ${entrada.clase}::${entrada.constante}${sugerenciaMultiple}`,
            severidad: obtenerSeveridadRegla('hardcoded-enum-value'),
            linea: i,
            columna: match.index,
            columnaFin: match.index + match[0].length,
            sugerencia: `Reemplazar '${valor}' con ${entrada.clase}::${entrada.constante}`,
            fuente: 'estatico',
          });
        }
      }
    };

    buscarEnRegex(regexComparacion);
    buscarEnRegex(regexAsignacion);
    buscarEnRegex(regexCase);
    buscarEnRegex(regexSqlValor);
  }

  return violaciones;
}

/* =======================================================================
 * 1.3 ENDPOINT ACCEDE BD
 * Detecta queries directas en controllers/endpoints.
 * Los controllers deben delegar a repositories.
 * ======================================================================= */

function verificarEndpointAccedeBd(lineas: string[], rutaArchivo: string): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Solo aplicar a archivos Controller/Endpoints — capa de transporte.
   * El protocolo dice: "ENDPOINTS no deben acceder a BD directamente".
   * Services son capa valida de delegacion (el protocolo los lista como destino aceptable),
   * por lo tanto NO se flaggean aqui. */
  const nombreArchivo = path.basename(rutaArchivo);
  if (!/Controller|Endpoints/i.test(nombreArchivo)) {
    return violaciones;
  }

  /* Excluir archivos dentro de Repositories, Database base o Glory framework.
   * Glory/ es framework externo con su propia arquitectura. */
  if (rutaArchivo.includes('/Glory/') || rutaArchivo.includes('/Repositories/') ||
      rutaArchivo.includes('/Database/') || rutaArchivo.includes('BaseRepository')) {
    return violaciones;
  }

  /* Patrones de acceso directo a BD.
   * Excluimos ->query( generico porque puede ser un query builder, no BD directa.
   * $wpdb metodos especificos: query, get_results, get_var, get_row, insert, update, delete. */
  const regexAccesoBd = /(\$this->pg|\$wpdb->(?:query|get_results|get_var|get_row|insert|update|delete|prepare)\s*\(|PostgresService|->ejecutar\()/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaTrimmed = linea.trim();

    /* Saltar comentarios */
    if (lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/**') ||
        lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('#') ||
        lineaTrimmed.startsWith('/*')) {
      continue;
    }

    /* Saltar sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line endpoint-accede-bd')) {
      continue;
    }
    if (linea.includes('sentinel-disable endpoint-accede-bd')) {
      continue;
    }

    /* Excluir transacciones: START TRANSACTION, COMMIT, ROLLBACK son
     * aceptables en controllers para coordinar operaciones cross-repo */
    if (/\b(START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(linea)) {
      continue;
    }

    const match = regexAccesoBd.exec(linea);
    if (match) {
      violaciones.push({
        reglaId: 'endpoint-accede-bd',
        mensaje: `Query directa en controller/endpoint ('${match[1]}'). Mover logica de datos a un Repository o Service.`,
        severidad: obtenerSeveridadRegla('endpoint-accede-bd'),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[1].length,
        sugerencia: 'Extraer la query a un metodo en el Repository correspondiente.',
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* =======================================================================
 * 1.4 INTERVAL SIN WHITELIST
 * Detecta INTERVAL con variable interpolada sin whitelist de validacion.
 * Vector de inyeccion SQL.
 * ======================================================================= */

function verificarIntervalSinWhitelist(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Patron: INTERVAL seguido de variable PHP interpolada */
  const regexInterval = /INTERVAL\s+['"]?\s*[\$\{]/i;
  /* Alternativa: INTERVAL con comilla y variable dentro */
  const regexInterval2 = /INTERVAL\s+'\s*\$/i;

  /* Patrones de whitelist en lineas cercanas */
  const regexWhitelist = /\b(in_array|match\s*\(|switch\s*\(|\$validos|\$ventanas|allowedIntervals|intervalosPermitidos|ventanasValidas)\b/i;
  const VENTANA_WHITELIST = 40;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Saltar comentarios */
    const lineaTrimmed = linea.trim();
    if (lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/**') ||
        lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('#') ||
        lineaTrimmed.startsWith('/*')) {
      continue;
    }

    /* Saltar sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line interval-sin-whitelist')) {
      continue;
    }
    if (linea.includes('sentinel-disable interval-sin-whitelist')) {
      continue;
    }

    if (regexInterval.test(linea) || regexInterval2.test(linea)) {
      /* Verificar si hay whitelist en las lineas anteriores */
      let tieneWhitelist = false;
      const inicioVentana = Math.max(0, i - VENTANA_WHITELIST);

      for (let j = inicioVentana; j < i; j++) {
        if (regexWhitelist.test(lineas[j])) {
          tieneWhitelist = true;
          break;
        }
      }

      if (!tieneWhitelist) {
        violaciones.push({
          reglaId: 'interval-sin-whitelist',
          mensaje: 'INTERVAL con variable interpolada sin whitelist. Vector de inyeccion SQL. Validar con in_array() contra valores permitidos.',
          severidad: obtenerSeveridadRegla('interval-sin-whitelist'),
          linea: i,
          sugerencia: "Agregar whitelist: $validos = ['7 days', '30 days']; if (!in_array($intervalo, $validos, true)) $intervalo = '30 days';",
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/* =======================================================================
 * 1.5 OPEN REDIRECT
 * Detecta wp_redirect() o header('Location:') con variable sin validar.
 * ======================================================================= */

function verificarOpenRedirect(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Patron: wp_redirect con variable (no string literal) */
  const regexWpRedirect = /\bwp_redirect\s*\(\s*\$/;
  /* Patron: header Location con variable */
  const regexHeaderLocation = /\bheader\s*\(\s*['"]Location:\s*['"]?\s*\.\s*\$/i;
  /* Patron de validacion cercana */
  const regexValidacion = /\b(wp_validate_redirect|wp_safe_redirect|esc_url|filter_var\s*\([^,]*,\s*FILTER_VALIDATE_URL)\b/;
  const VENTANA_VALIDACION = 5;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaTrimmed = linea.trim();

    /* Saltar comentarios */
    if (lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/**') ||
        lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('#') ||
        lineaTrimmed.startsWith('/*')) {
      continue;
    }

    /* Saltar sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line open-redirect')) {
      continue;
    }
    if (linea.includes('sentinel-disable open-redirect')) {
      continue;
    }

    const esRedirectInseguro = regexWpRedirect.test(linea) || regexHeaderLocation.test(linea);

    if (esRedirectInseguro) {
      /* Si la linea usa wp_safe_redirect en vez de wp_redirect, es seguro */
      if (/\bwp_safe_redirect\b/.test(linea)) {
        continue;
      }

      /* Excluir cuando la URL viene de funciones WordPress internas seguras.
       * wp_login_url(), home_url(), admin_url(), get_permalink(), site_url()
       * generan URLs internas del sitio — no son open redirect. */
      const regexUrlInterna = /\b(wp_login_url|home_url|admin_url|get_permalink|site_url|network_site_url|get_post_permalink|wp_logout_url)\s*\(/;
      if (regexUrlInterna.test(linea)) {
        continue;
      }

      /* Buscar la variable usada en el redirect para verificar su origen
       * en las 5 lineas anteriores */
      const matchVar = /wp_redirect\s*\(\s*(\$\w+)/.exec(linea);
      if (matchVar) {
        const nombreVar = matchVar[1].replace('$', '\\$');
        const regexAsignacionSegura = new RegExp(
          `${nombreVar}\\s*=\\s*(wp_login_url|home_url|admin_url|get_permalink|site_url|network_site_url|wp_logout_url)\\s*\\(`
        );
        let origenSeguro = false;
        for (let j = Math.max(0, i - 8); j < i; j++) {
          if (regexAsignacionSegura.test(lineas[j])) {
            origenSeguro = true;
            break;
          }
        }
        if (origenSeguro) { continue; }
      }

      /* Verificar si hay validacion en lineas cercanas (antes y despues) */
      let tieneValidacion = false;
      const inicioVentana = Math.max(0, i - VENTANA_VALIDACION);
      const finVentana = Math.min(lineas.length, i + VENTANA_VALIDACION);

      for (let j = inicioVentana; j < finVentana; j++) {
        if (regexValidacion.test(lineas[j])) {
          tieneValidacion = true;
          break;
        }
      }

      if (!tieneValidacion) {
        violaciones.push({
          reglaId: 'open-redirect',
          mensaje: 'Redireccion con URL no validada. Riesgo de Open Redirect. Usar wp_safe_redirect() o wp_validate_redirect().',
          severidad: obtenerSeveridadRegla('open-redirect'),
          linea: i,
          sugerencia: 'Usar wp_safe_redirect($url) o validar con wp_validate_redirect($url, home_url()).',
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/* =======================================================================
 * 1.6 RETURN VOID CRITICO
 * Detecta metodos publicos que hacen INSERT/UPDATE/DELETE
 * pero retornan void (o no tienen return type).
 * ======================================================================= */

function verificarReturnVoidCritico(texto: string, lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Buscar metodos publicos con su signature y body */
  const regexMetodoPublico = /public\s+function\s+(\w+)\s*\([^)]*\)\s*(?::\s*(\w+))?\s*\{/g;

  let match: RegExpExecArray | null;
  while ((match = regexMetodoPublico.exec(texto)) !== null) {
    const nombreMetodo = match[1];
    const returnType = match[2] || null; /* null = sin return type */

    /* Solo reportar si es void o sin return type */
    if (returnType !== null && returnType !== 'void') {
      continue;
    }

    /* Encontrar la linea donde esta la signature */
    const posicion = match.index;
    const lineaSignature = texto.substring(0, posicion).split('\n').length - 1;

    /* Saltar sentinel-disable */
    if (lineaSignature > 0 &&
        lineas[lineaSignature - 1]?.includes('sentinel-disable-next-line return-void-critico')) {
      continue;
    }

    /* Encontrar el cuerpo del metodo (buscar la llave de cierre) */
    const inicioBody = texto.indexOf('{', posicion + match[0].length - 1);
    if (inicioBody === -1) { continue; }

    /* Contar llaves para encontrar el fin del metodo */
    let profundidad = 1;
    let pos = inicioBody + 1;
    while (pos < texto.length && profundidad > 0) {
      if (texto[pos] === '{') { profundidad++; }
      else if (texto[pos] === '}') { profundidad--; }
      pos++;
    }

    const cuerpo = texto.substring(inicioBody, pos);

    /* Excluir constructores y metodos de setup de rutas */
    if (/^(__construct|register(Routes)?|registrar(Rutas)?)$/i.test(nombreMetodo)) {
      continue;
    }

    /* Verificar si el cuerpo tiene operaciones de escritura (DML + DDL) */
    const tieneEscritura = /\b(INSERT|UPDATE|DELETE|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE|->insertar\(|->actualizar\(|->eliminar\(|->insert\(|->update\(|->delete\(|->query\(.*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP))/i.test(cuerpo);

    if (tieneEscritura) {
      const tipoActual = returnType === 'void' ? 'void' : 'sin return type';
      violaciones.push({
        reglaId: 'return-void-critico',
        mensaje: `Metodo '${nombreMetodo}()' hace operaciones de escritura pero retorna ${tipoActual}. El caller no puede verificar exito/fallo.`,
        severidad: obtenerSeveridadRegla('return-void-critico'),
        linea: lineaSignature,
        sugerencia: `Cambiar return type a bool o un tipo que indique resultado de la operacion.`,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* =======================================================================
 * 2.6 ISLA NO REGISTRADA
 * Detecta archivos en islands/ que no estan registrados en appIslands.tsx.
 * ======================================================================= */

function verificarIslaNoRegistrada(rutaArchivo: string, texto: string): Violacion[] {
  if (!cacheIslasRegistradas) { return []; }

  /* Respetar sentinel-disable a nivel de archivo */
  if (texto.includes('sentinel-disable isla-no-registrada')) { return []; }

  /* Solo verificar archivos dentro de islands/ */
  if (!rutaArchivo.includes('/islands/')) { return []; }

  /* Glory tiene su propio registro de islas (main.tsx), no usa appIslands.tsx */
  if (rutaArchivo.includes('/Glory/')) { return []; }

  const nombreArchivo = path.basename(rutaArchivo, path.extname(rutaArchivo));

  /* Excluir index, hooks, utils y archivos de componentes auxiliares */
  if (nombreArchivo === 'index' || /^use[A-Z]/.test(nombreArchivo) ||
      nombreArchivo.startsWith('_') || nombreArchivo === 'types') {
    return [];
  }

  /* Excluir sub-componentes: archivos dentro de subdirectorios como
   * components/, hooks/, stores/, utils/, styles/, types/, constants/
   * NO son islas — son modulos internos importados por las islas.
   * Solo los archivos directamente en islands/ o islands/NombreIsla/
   * son candidatos a ser islas top-level. */
  const despuesIslands = rutaArchivo.split('/islands/')[1] || '';
  const segmentos = despuesIslands.split('/').filter(Boolean);
  /* Si hay mas de 2 segmentos (carpeta-isla/subcarpeta/archivo.tsx)
   * es un sub-componente, no una isla. Ej: cap/components/Modal.tsx → 3 segs */
  if (segmentos.length > 2) {
    return [];
  }

  if (!cacheIslasRegistradas.has(nombreArchivo)) {
    return [{
      reglaId: 'isla-no-registrada',
      mensaje: `Isla '${nombreArchivo}' no esta registrada en appIslands.tsx. El componente no sera accesible.`,
      severidad: obtenerSeveridadRegla('isla-no-registrada'),
      linea: 0,
      sugerencia: `Agregar import y registro en App/React/appIslands.tsx para activar esta isla.`,
      fuente: 'estatico',
    }];
  }

  return [];
}

/* =======================================================================
 * 3.1 N+1 QUERY
 * Detecta queries dentro de loops (foreach, for, while).
 * El patron N+1 causa overhead de multiples roundtrips a BD.
 * ======================================================================= */

function verificarNPlus1Query(lineas: string[], rutaArchivo?: string): Violacion[] {
  const violaciones: Violacion[] = [];

  const regexLoop = /\b(foreach|for|while)\s*\(/;
  const regexQuery = /(\$this->pg|\$wpdb->|->ejecutar\(|->buscarPorId\(|->get_results\(|->get_var\(|->get_row\(|->query\()/;
  const regexCache = /(\$cache|wp_cache_get|cache_get|Redis::|Memcached::|static\s+\$cache)/;

  /* Set para evitar reportar la misma linea de query multiples veces.
   * Un loop anidado puede ser detectado tanto por el loop externo como el interno. */
  const lineasYaReportadas = new Set<number>();

  /* Excluir seeders: se ejecutan una sola vez en inicializacion,
   * N+1 es aceptable y esperable en ese contexto. */
  const nombreArchivo = path.basename(rutaArchivo || '');
  if (/Seeder/i.test(nombreArchivo)) { return violaciones; }

  for (let i = 0; i < lineas.length; i++) {
    const lineaTrimmed = lineas[i].trim();

    /* Saltar comentarios */
    if (lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('//') ||
        lineaTrimmed.startsWith('#') || lineaTrimmed.startsWith('/*')) {
      continue;
    }

    if (!regexLoop.test(lineas[i])) { continue; }

    /* Saltar sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line n-plus-1-query')) {
      continue;
    }

    /* Encontrar el cuerpo del loop con conteo de llaves */
    let llaves = 0;
    let tieneQuery = false;
    let tieneCache = false;
    let lineaQuery = -1;
    let encontroCuerpo = false;
    let finBloque = i;

    for (let j = i; j < Math.min(lineas.length, i + 60); j++) {
      for (const char of lineas[j]) {
        if (char === '{') { llaves++; encontroCuerpo = true; }
        if (char === '}') { llaves--; }
      }

      if (j > i && encontroCuerpo) {
        if (regexQuery.test(lineas[j]) && lineaQuery === -1) {
          tieneQuery = true;
          lineaQuery = j;
        }
        if (regexCache.test(lineas[j])) {
          tieneCache = true;
        }
      }

      if (encontroCuerpo && llaves <= 0) {
        finBloque = j;
        break;
      }
    }

    if (tieneQuery && !tieneCache && lineaQuery !== -1 && !lineasYaReportadas.has(lineaQuery)) {
      lineasYaReportadas.add(lineaQuery);
      violaciones.push({
        reglaId: 'n-plus-1-query',
        mensaje: 'Query dentro de loop (N+1). Usar batch query, JOIN o cache para evitar overhead de red.',
        severidad: obtenerSeveridadRegla('n-plus-1-query'),
        linea: lineaQuery,
        sugerencia: 'Extraer la query fuera del loop: obtener todos los registros de una vez y filtrar en memoria.',
        fuente: 'estatico',
      });
    }

    /* Avanzar al fin del bloque para no re-analizar loops internos
     * como si fueran loops independientes (causaba duplicados). */
    if (finBloque > i) {
      i = finBloque;
    }
  }

  return violaciones;
}

/* =======================================================================
 * 3.2 CONTROLLER FQN INLINE
 * Detecta Fully Qualified Names (\App\..., \Glory\...) usados inline
 * en vez de use statements al inicio del archivo.
 * ======================================================================= */

function verificarFqnInline(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  let pasadoUseStatements = false;

  for (let i = 0; i < lineas.length; i++) {
    const lineaTrimmed = lineas[i].trim();

    /* Saltar comentarios */
    if (lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('//') ||
        lineaTrimmed.startsWith('#') || lineaTrimmed.startsWith('/*')) {
      continue;
    }

    /* Despues de class/function/namespace, ya estamos fuera de la zona de use.
     * NOTA: namespace declaration contiene \App\ en proyectos cuyo namespace es
     * App\..., pero NO es FQN inline — es la identidad del archivo. Se excluye. */
    if (/^(class |abstract\s+class |final\s+class |function |namespace )/.test(lineaTrimmed)) {
      pasadoUseStatements = true;
    }

    /* Excluir la propia namespace declaration */
    if (/^namespace\s+/.test(lineaTrimmed)) { continue; }

    /* Solo aplicar dentro del cuerpo de la clase/funcion */
    if (!pasadoUseStatements) { continue; }

    /* Saltar sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line controller-fqn-inline')) {
      continue;
    }

    /* Detectar \App\ o \Glory\ inline */
    if (/\\(App|Glory)\\/.test(lineas[i])) {
      /* Excluir use statements sueltos (que se puedan haber puesto tarde) */
      if (/^use\s+/.test(lineaTrimmed)) { continue; }
      /* Excluir strings que son paths de archivos */
      if (/['"]\/?(App|Glory)\//.test(lineas[i])) { continue; }
      /* Excluir instanceof checks */
      if (/instanceof/.test(lineas[i])) { continue; }
      /* Excluir class annotations/docblocks */
      if (/@\w+/.test(lineaTrimmed)) { continue; }

      violaciones.push({
        reglaId: 'controller-fqn-inline',
        mensaje: 'FQN inline (\\App\\ o \\Glory\\). Usar "use" statement al inicio del archivo.',
        severidad: obtenerSeveridadRegla('controller-fqn-inline'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* =======================================================================
 * 3.3 PHP SIN RETURN TYPE
 * Detecta funciones publicas sin return type declaration.
 * ======================================================================= */

function verificarPhpSinReturnType(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Saltar sentinel-disable */
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line php-sin-return-type')) {
      continue;
    }

    /* Matchear public function nombre(...) sin : tipo antes de { */
    const match = /public\s+function\s+(\w+)\s*\([^)]*\)\s*\{/.exec(linea);
    if (!match) { continue; }

    const nombre = match[1];

    /* Excluir constructores, destructores y metodos magicos */
    if (/^(__construct|__destruct|__clone|__toString|__get|__set|__isset|__unset|setUp|tearDown)$/.test(nombre)) {
      continue;
    }

    /* Verificar si tiene return type (: antes de {) */
    if (/\)\s*:\s*\S+\s*\{/.test(linea)) { continue; }

    /* Verificar si tiene @return en docblock de las lineas anteriores */
    let tieneDocReturn = false;
    for (let j = Math.max(0, i - 10); j < i; j++) {
      if (/@return/.test(lineas[j])) {
        tieneDocReturn = true;
        break;
      }
    }

    const msgExtra = tieneDocReturn ? ' (tiene @return en docblock, agregar type hint nativo)' : '';
    violaciones.push({
      reglaId: 'php-sin-return-type',
      mensaje: `Funcion publica '${nombre}()' sin return type declaration.${msgExtra}`,
      severidad: obtenerSeveridadRegla('php-sin-return-type'),
      linea: i,
      sugerencia: `Agregar ': tipo' despues de los parentesis, antes de '{'. Ej: public function ${nombre}(): bool {`,
      fuente: 'estatico',
    });
  }

  return violaciones;
}

/* =======================================================================
 * 3.5 REPOSITORY SIN WHITELIST COLUMNAS (SELECT *)
 * Detecta SELECT * FROM que no lista columnas explicitas.
 * ======================================================================= */

function verificarSelectStar(lineas: string[], rutaArchivo: string): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Excluir archivos generados y migrations */
  if (rutaArchivo.includes('_generated/') || rutaArchivo.includes('/migrations/') ||
      rutaArchivo.includes('/seeders/')) {
    return [];
  }

  /* BaseRepository es infraestructura generica — sus SELECT * son intencionales */
  if (rutaArchivo.includes('BaseRepository.php')) {
    return [];
  }

  /* Detectar si el archivo tiene secciones auto-generadas.
   * Los metodos entre SECCION AUTO-GENERADA y METODOS CUSTOM se regeneran
   * automaticamente y usan SELECT * por diseno del Schema System. */
  const textoCompleto = lineas.join('\n');
  const tieneSeccionAutoGenerada = textoCompleto.includes('SECCION AUTO-GENERADA');
  let enSeccionAutoGenerada = false;

  for (let i = 0; i < lineas.length; i++) {
    const lineaTrimmed = lineas[i].trim();

    /* Rastrear inicio/fin de seccion auto-generada */
    if (lineaTrimmed.includes('SECCION AUTO-GENERADA') && tieneSeccionAutoGenerada) {
      enSeccionAutoGenerada = true;
    }
    if (lineaTrimmed.includes('METODOS CUSTOM') || lineaTrimmed.includes('=== CUSTOM')) {
      enSeccionAutoGenerada = false;
    }

    /* Saltar comentarios */
    if (lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('//') ||
        lineaTrimmed.startsWith('#') || lineaTrimmed.startsWith('/*')) {
      continue;
    }

    /* Saltar lineas en seccion auto-generada */
    if (enSeccionAutoGenerada) {
      continue;
    }

    /* Saltar sentinel-disable */
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line repository-sin-whitelist-columnas')) {
      continue;
    }

    if (/SELECT\s+\*\s+FROM/i.test(lineas[i])) {
      /* Excluir SELECT * FROM sobre CTEs (con nombre en minuscula o camelCase)
       * Un CTE es un subquery nombrado con WITH alias AS (...), no una tabla real.
       * Las tablas reales en este proyecto siempre tienen nombres en snake_case
       * y estan registradas en el Schema System. Un CTE tipico: SELECT * FROM scored */
      const lineaSelectStar = lineas[i].trim();
      const matchCte = lineaSelectStar.match(/SELECT\s+\*\s+FROM\s+(\w+)/i);
      if (matchCte) {
        const nombreTabla = matchCte[1];
        /* Si el nombre no contiene underscore y empieza en minuscula, es probablemente un CTE */
        if (!nombreTabla.includes('_') && nombreTabla[0] === nombreTabla[0].toLowerCase()) {
          continue;
        }
      }
      violaciones.push({
        reglaId: 'repository-sin-whitelist-columnas',
        mensaje: 'SELECT * FROM no lista columnas explicitas. Especificar columnas para eficiencia y evitar breaking changes.',
        severidad: obtenerSeveridadRegla('repository-sin-whitelist-columnas'),
        linea: i,
        sugerencia: 'Reemplazar * con las columnas especificas que necesitas: SELECT col1, col2 FROM ...',
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
