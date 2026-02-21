/*
 * Analyzer especializado para archivos PHP/WordPress.
 * Detecta patrones especificos del ecosistema WordPress
 * que no son facilmente detectables con las reglas genericas.
 */

import * as vscode from 'vscode';
import { Violacion } from '../types';
import { reglaHabilitada, obtenerSeveridadRegla } from '../config/ruleRegistry';

/*
 * Analiza un archivo PHP en busca de violaciones especificas de WordPress.
 * Complementa al staticAnalyzer con reglas que requieren contexto PHP.
 */
export function analizarPhp(documento: vscode.TextDocument): Violacion[] {
  const texto = documento.getText();
  const lineas = texto.split('\n');
  const violaciones: Violacion[] = [];

  /* Solo ejecutar verificaciones cuyas reglas esten habilitadas */
  if (reglaHabilitada('controller-sin-trycatch')) {
    violaciones.push(...verificarControllerSinTryCatch(lineas));
  }
  if (reglaHabilitada('wpdb-sin-prepare')) {
    violaciones.push(...verificarWpdbSinPrepareContextual(lineas));
  }
  if (reglaHabilitada('request-json-directo')) {
    violaciones.push(...verificarRequestJsonDirecto(lineas));
  }
  if (reglaHabilitada('json-decode-inseguro')) {
    violaciones.push(...verificarJsonDecodeInseguro(lineas));
  }
  if (reglaHabilitada('exec-sin-escapeshellarg')) {
    violaciones.push(...verificarExecSinEscape(lineas));
  }
  if (reglaHabilitada('curl-sin-verificacion')) {
    violaciones.push(...verificarCurlSinVerificacion(lineas));
  }
  if (reglaHabilitada('temp-sin-finally')) {
    violaciones.push(...verificarArchivosTemporalesSinFinally(texto, lineas));
  }
  if (reglaHabilitada('sanitizacion-faltante')) {
    violaciones.push(...verificarSanitizacionFaltante(lineas));
  }

  return violaciones;
}

/*
 * Detecta metodos publicos de controllers sin try-catch global.
 * Un controller se identifica por: clase con sufijo Endpoints/Controller
 * y metodos publicos que no envuelven su cuerpo en try-catch.
 *
 * Exclusiones para evitar falsos positivos:
 * - Metodos de configuracion: registerRoutes, register (solo registran rutas, no handlers).
 * - Permission callbacks: metodos que retornan bool para verificar permisos
 *   (can*, verificar*, checkPermission). WordPress maneja sus errores.
 * - Clases que usan trait ConCallbackSeguro: el trait ya envuelve cada
 *   handler en try-catch via callbackSeguro(), asi que el try-catch
 *   individual es innecesario.
 */
function verificarControllerSinTryCatch(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  const esController = lineas.some(l =>
    /class\s+\w*(Endpoints|Controller|Controlador)\b/.test(l)
  );

  if (!esController) {
    return [];
  }

  /* Si el archivo no registra rutas REST (register_rest_route, WP_REST_Response, WP_REST_Request),
   * no es un controller REST — puede ser un controller de admin hooks (ej: OpcionPanelController).
   * En ese caso, no aplicar la regla controller-sin-trycatch. */
  const textoCompleto = lineas.join('\n');
  const esControllerRest = /register_rest_route|WP_REST_Response|WP_REST_Request/.test(textoCompleto);
  if (!esControllerRest) {
    return [];
  }

  /* Si la clase usa un trait que centraliza try-catch (ConCallbackSeguro),
   * no reportar falta de try-catch en metodos individuales */
  const usaTraitSeguro = lineas.some(l =>
    /use\s+ConCallbackSeguro\b/.test(l)
  );

  if (usaTraitSeguro) {
    return [];
  }

  /* Nombres de metodos que son de configuracion o permission callbacks,
   * no handlers de endpoint. No necesitan try-catch propio. */
  const esMetodoExcluido = (nombre: string): boolean => {
    /* Metodos de registro de rutas (ingles y espanol) */
    if (/^register(Routes)?$/i.test(nombre)) { return true; }
    if (/^registrar(Rutas)?$/i.test(nombre)) { return true; }
    /* Permission callbacks: can*, verificar*, checkPermission */
    if (/^(can[A-Z]|verificar|checkPermission)/i.test(nombre)) { return true; }
    /* Metodos de setup de BD y hooks de WordPress admin */
    if (/^(crearTabla|enqueue)/i.test(nombre)) { return true; }
    return false;
  };

  let dentroDeMetodoPublico = false;
  let lineaMetodo = 0;
  let nombreMetodo = '';
  let llaves = 0;
  let tieneTryCatch = false;
  let primeraInstruccion = true;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    /* Detectar inicio de metodo publico */
    const matchMetodo = /public\s+(?:static\s+)?function\s+(\w+)\s*\(/.exec(linea);
    if (matchMetodo) {
      /* Si habia un metodo previo sin try-catch, reportar */
      if (dentroDeMetodoPublico && !tieneTryCatch && nombreMetodo && !esMetodoExcluido(nombreMetodo)) {
        violaciones.push({
          reglaId: 'controller-sin-trycatch',
          mensaje: `Metodo publico "${nombreMetodo}" sin try-catch global. Envolver cuerpo completo en try { ... } catch (\\Throwable $e).`,
          severidad: obtenerSeveridadRegla('controller-sin-trycatch'),
          linea: lineaMetodo,
          fuente: 'estatico',
        });
      }

      dentroDeMetodoPublico = true;
      lineaMetodo = i;
      nombreMetodo = matchMetodo[1];
      llaves = 0;
      tieneTryCatch = false;
      primeraInstruccion = true;
      continue;
    }

    if (!dentroDeMetodoPublico) {
      continue;
    }

    /* Contar llaves para saber cuando termina el metodo */
    for (const char of lineas[i]) {
      if (char === '{') { llaves++; }
      if (char === '}') { llaves--; }
    }

    /* Buscar try en cualquier parte del cuerpo del metodo.
     * Un try-catch que envuelve el cuerpo principal (aunque no sea la primera
     * instruccion) es suficiente para proteger el endpoint. */
    if (linea.startsWith('try') || /\btry\s*\{/.test(linea)) {
      tieneTryCatch = true;
    }

    /* Marcar fin de primera instruccion (para seguimiento de llaves) */
    if (primeraInstruccion && linea !== '' && linea !== '{') {
      primeraInstruccion = false;
    }

    /* Metodo terminado */
    if (llaves <= 0 && !primeraInstruccion) {
      if (!tieneTryCatch && nombreMetodo && !esMetodoExcluido(nombreMetodo)) {
        /* Excluir metodos triviales (<5 lineas efectivas) y metodos puros
         * que solo retornan constantes/arrays sin operaciones I/O */
        const lineasEfectivas = contarLineasMetodo(lineas, lineaMetodo, i);
        const esMetodoTrivial = lineasEfectivas < 5;
        const esMetodoPuro = esRetornoConstante(lineas, lineaMetodo, i);
        if (!esMetodoTrivial && !esMetodoPuro) {
          violaciones.push({
            reglaId: 'controller-sin-trycatch',
            mensaje: `Metodo publico "${nombreMetodo}" sin try-catch global. Envolver cuerpo completo en try { ... } catch (\\Throwable $e).`,
            severidad: obtenerSeveridadRegla('controller-sin-trycatch'),
            linea: lineaMetodo,
            fuente: 'estatico',
          });
        }
      }
      dentroDeMetodoPublico = false;
    }
  }

  return violaciones;
}

/* Cuenta lineas efectivas de un metodo (excluyendo vacias y comentarios) */
function contarLineasMetodo(lineas: string[], inicio: number, fin: number): number {
  let cuenta = 0;
  for (let i = inicio; i <= fin && i < lineas.length; i++) {
    const trimmed = lineas[i].trim();
    if (trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
      cuenta++;
    }
  }
  return cuenta;
}

/* Detecta metodos "puros" que solo retornan valores constantes (arrays, strings, numeros).
 * Estos metodos no pueden lanzar excepciones y no necesitan try-catch.
 * Ejemplo: public function listarPlanes() { return new WP_REST_Response([...]); } */
function esRetornoConstante(lineas: string[], inicio: number, fin: number): boolean {
  let tieneIO = false;
  for (let i = inicio; i <= fin && i < lineas.length; i++) {
    const trimmed = lineas[i].trim();
    /* Ignorar lineas vacias, comentarios, llaves y la firma del metodo */
    if (trimmed === '' || trimmed === '{' || trimmed === '}' ||
        trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') ||
        /^public\s+/.test(trimmed)) {
      continue;
    }
    /* Si hay operaciones de I/O, BD, llamadas a servicios, no es puro */
    if (/\$this\s*->|self::|static::|new\s+\w+(?!.*WP_REST_Response)|\$wpdb|\bquery\b|\bfetch\b|\bexec\b|\bcurl|\bfile_|\bfopen\b/.test(trimmed)) {
      /* Permitir solo 'new WP_REST_Response' y 'return' */
      if (!/^\s*return\s+new\s+\\?WP_REST_Response/.test(trimmed)) {
        tieneIO = true;
        break;
      }
    }
  }
  return !tieneIO;
}

/*
 * Verifica $wpdb sin prepare con mas contexto.
 * Detecta cuando la linea NO contiene prepare() pero si query/get_var, etc.
 * Excluye falsos positivos:
 * - prepare() anidado como argumento: $wpdb->get_row($wpdb->prepare(...))
 * - Queries sin parametros de usuario (solo constantes de tabla, sin WHERE/placeholders)
 * - Sentencias de control de transaccion y DDL
 */
function verificarWpdbSinPrepareContextual(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Buscar llamadas $wpdb->query/get_var/etc. */
    const matchWpdb = /\$wpdb\s*->\s*(query|get_var|get_results|get_row|get_col)\s*\(/.exec(linea);
    if (!matchWpdb) {
      continue;
    }

    /* Excluir comandos que no llevan parametros de usuario y no necesitan prepare():
     * - Control de transaccion: START TRANSACTION, ROLLBACK, COMMIT, SAVEPOINT.
     * - DDL (Data Definition Language): ALTER TABLE, CREATE TABLE, DROP TABLE, TRUNCATE.
     *   El DDL no acepta parametros en prepare() y usa nombres de tabla internos. */
    const argumento = linea.slice(linea.indexOf(matchWpdb[0]) + matchWpdb[0].length).trim();
    if (/^['"](START\s+TRANSACTION|ROLLBACK|COMMIT|SAVEPOINT|RELEASE\s+SAVEPOINT)/i.test(argumento)) {
      continue;
    }
    if (/^["']?\s*(ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE|CREATE\s+INDEX|DROP\s+INDEX)/i.test(argumento)) {
      continue;
    }
    /* Excluir tambien si el argumento es una interpolacion directa de DDL (sin comillas al inicio) */
    if (/^\s*"(ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE)/i.test(argumento)) {
      continue;
    }

    /* Verificar si la misma linea contiene prepare (incluyendo anidado como argumento).
     * Esto cubre el patron $wpdb->get_row($wpdb->prepare(...)) */
    if (/\$wpdb\s*->\s*prepare\s*\(/.test(linea)) {
      continue;
    }

    /* Verificar si prepare() esta en las 1-3 lineas siguientes (argumento multi-linea).
     * Cubre el patron:
     *   $wpdb->get_row(
     *       $wpdb->prepare(...),
     *       ARRAY_A
     *   ); */
    let prepareEnLineaSiguiente = false;
    for (let k = i + 1; k <= Math.min(lineas.length - 1, i + 3); k++) {
      if (/\$wpdb\s*->\s*prepare\s*\(/.test(lineas[k])) {
        prepareEnLineaSiguiente = true;
        break;
      }
    }
    if (prepareEnLineaSiguiente) {
      continue;
    }

    /* Queries sin parametros de usuario no necesitan prepare().
     * WordPress 6.2+ genera un _doing_it_wrong si se llama prepare() sin placeholders.
     * Patron: SELECT sin WHERE/JOIN/HAVING y sin placeholders (%d, %s, %f) */
    const lineaCompleta = obtenerSentenciaMultilinea(lineas, i);
    if (esSentenciaSinParametrosUsuario(lineaCompleta)) {
      continue;
    }

    /* Si el argumento es una variable ($query, $sql, etc.), la prepare() pudo
     * haberse invocado muchas lineas antes para construir esa variable.
     * En ese caso ampliar la ventana de busqueda a 50 lineas hacia atras. */
    const matchVarArg = /^\$(\w+)/.exec(argumento);
    const ventanaLineas = matchVarArg ? 50 : 3;

    /* Verificar lineas anteriores: buscar $wpdb->prepare( en la ventana */
    let tienePrepareCercano = false;
    for (let j = Math.max(0, i - ventanaLineas); j < i; j++) {
      if (/\$wpdb\s*->\s*prepare\s*\(/.test(lineas[j])) {
        tienePrepareCercano = true;
        break;
      }
    }

    if (!tienePrepareCercano) {
      violaciones.push({
        reglaId: 'wpdb-sin-prepare',
        mensaje: `$wpdb->${matchWpdb[1]}() sin $wpdb->prepare(). Usar prepare() obligatoriamente.`,
        severidad: obtenerSeveridadRegla('wpdb-sin-prepare'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Reconstruye una sentencia SQL que puede estar partida en multiples lineas.
 * Busca hacia adelante hasta encontrar ';' o un maximo de 10 lineas.
 */
function obtenerSentenciaMultilinea(lineas: string[], inicio: number): string {
  let resultado = '';
  for (let i = inicio; i < Math.min(lineas.length, inicio + 10); i++) {
    resultado += ' ' + lineas[i];
    if (lineas[i].includes(';')) { break; }
  }
  return resultado;
}

/*
 * Determina si una sentencia SQL no tiene parametros de usuario.
 * Una query sin WHERE, JOIN, HAVING, SET y sin placeholders (%d, %s, %f)
 * es segura sin prepare() (ej: SELECT COUNT(*) FROM tabla, SHOW TABLES).
 */
function esSentenciaSinParametrosUsuario(sentencia: string): boolean {
  const upper = sentencia.toUpperCase();
  /* Si tiene placeholders de prepare(), claramente necesita prepare */
  if (/%[dsf]/.test(sentencia)) { return false; }
  /* Si no tiene clausulas que acepten input de usuario, es segura */
  const tieneClausulaConInput = /\b(WHERE|JOIN|HAVING|SET|VALUES|IN\s*\()\b/i.test(sentencia);
  return !tieneClausulaConInput;
}

/*
 * Verifica $request->get_json_params() pasado directamente a capas de datos.
 * Solo reporta si la variable que recibe el resultado se usa como argumento
 * bare (sin subscript de campo) en una llamada a funcion o metodo.
 *
 * Patron SEGURO (no reportar):   $datos['campo']  — acceso individual con sanitizacion.
 * Patron INSEGURO (reportar):    func($datos)     — array crudo pasado a otra capa.
 */
function verificarRequestJsonDirecto(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Detectar: $varNombre = $request->get_json_params() */
    const matchAsignacion = /(\$\w+)\s*=\s*\$request\s*->\s*get_json_params\s*\(\s*\)/.exec(linea);
    if (!matchAsignacion) {
      continue;
    }

    const varNombre = matchAsignacion[1];
    /* Escapar $ para construir el patron regex dinamico */
    const varEscapada = varNombre.replace('$', '\\$');

    /* Escanear las siguientes 30 lineas buscando uso bare de la variable.
     * "Bare" = la variable aparece como argumento sin acceso de subscript inmediato.
     * Se guarda lineaUso para marcar la linea del uso problematico, no la asignacion. */
    let lineaUso = -1;
    const fin = Math.min(lineas.length, i + 30);

    for (let j = i + 1; j < fin; j++) {
      const lineaJ = lineas[j];

      /* Patron: variable seguida de , o ) — posible argumento bare */
      const patronBare = new RegExp(`${varEscapada}\\s*[,\\)]`);
      if (!patronBare.test(lineaJ)) {
        continue;
      }

      /* Eliminar del analisis todos los accesos de subscript ($datos['campo'], $datos["campo"], $datos[$k])
       * para que no interfieran con la deteccion de uso bare en la misma linea */
      const lineaSinSubscript = lineaJ.replace(
        new RegExp(`${varEscapada}\\s*\\[[^\\]]*\\]`, 'g'),
        '__subscript__'
      );

      /* Excluir funciones de filtrado PHP: si la variable es argumento de array_intersect_key,
       * array_filter, array_map, array_keys, array_values o compact, es una operacion de
       * transformacion/reduccion, no un "paso bare a capa de datos". */
      const esFuncionFiltrado = /\b(array_intersect_key|array_filter|array_map|array_keys|array_values|array_diff_key|compact)\s*\(/.test(lineaJ);
      if (esFuncionFiltrado) {
        continue;
      }

      if (patronBare.test(lineaSinSubscript)) {
        lineaUso = j;
        break;
      }
    }

    if (lineaUso !== -1) {
      violaciones.push({
        reglaId: 'request-json-directo',
        mensaje: `${varNombre} de get_json_params() pasado directo como argumento. Filtrar campos esperados antes de pasar a la capa de datos.`,
        severidad: obtenerSeveridadRegla('request-json-directo'),
        /* Marcar la linea donde la variable se usa como argumento bare, no donde se asigna */
        linea: lineaUso,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* Detecta json_decode() sin verificacion de errores.
 * Reconoce multiples formas validas de proteccion:
 * - json_last_error() / json_last_error_msg() en lineas cercanas
 * - is_array() / is_object() sobre el resultado
 * - Null coalescing: json_decode(...) ?? [] o ?? default
 * - Ternario pre-validador: $x ? json_decode($x) : null
 * - Guard is_string/isset antes del decode (implica datos ya validados)
 * - if (!$resultado) / if ($resultado === null) post-decode */
function verificarJsonDecodeInseguro(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    if (!/json_decode\s*\(/.test(lineas[i])) {
      continue;
    }

    const lineaActual = lineas[i];

    /* --- Proteccion inline en la misma linea --- */

    /* Null coalescing: json_decode(...) ?? [] o ?? default */
    if (/json_decode\s*\([^)]*\)\s*\?\?/.test(lineaActual)) {
      continue;
    }

    /* Ternario pre-validador: $var ? json_decode($var) : default */
    if (/\?\s*\\?json_decode/.test(lineaActual)) {
      continue;
    }

    /* --- Proteccion en lineas cercanas (ventana +-5) --- */

    let tieneVerificacion = false;

    /* Buscar guards y verificaciones en las 5 lineas anteriores */
    for (let j = Math.max(0, i - 5); j < i; j++) {
      /* is_string() o isset() antes del json_decode — implica dato ya validado */
      if (/\b(is_string|isset|!empty)\s*\(/.test(lineas[j])) {
        tieneVerificacion = true;
        break;
      }
    }

    /* Buscar verificaciones en las 6 lineas siguientes */
    if (!tieneVerificacion) {
      for (let j = i; j < Math.min(lineas.length, i + 7); j++) {
        if (/json_last_error|json_last_error_msg|is_array|is_object/.test(lineas[j])) {
          tieneVerificacion = true;
          break;
        }
        /* Null check del resultado: if (!$var), if ($var === null), if (empty($var)) */
        if (j > i && /if\s*\(\s*(!|\bnull\b|empty\s*\()/.test(lineas[j])) {
          tieneVerificacion = true;
          break;
        }
        /* Acceso condicional con ?? en la linea siguiente (ej: $data['campo'] ?? 'default') */
        if (j > i && /\?\?/.test(lineas[j])) {
          tieneVerificacion = true;
          break;
        }
      }
    }

    if (!tieneVerificacion) {
      violaciones.push({
        reglaId: 'json-decode-inseguro',
        mensaje: 'json_decode() sin verificar json_last_error(). Datos corruptos se propagan como null silencioso.',
        severidad: obtenerSeveridadRegla('json-decode-inseguro'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* Detecta exec()/shell_exec() sin escapeshellarg().
 * Excluye:
 * - proc_open() con array como primer argumento (seguro por diseno: PHP 7.4+
 *   ejecuta cada elemento como argv separado, sin pasar por shell).
 * - $objeto->exec() (metodo de instancia, ej: PDO::exec), no es shell exec.
 * - Comandos 100% literales (strings hardcodeados o ternarios de literales).
 * - exec($cmd) donde $cmd se construyo con sprintf + escapeshellarg en todas
 *   las partes string (%s). Placeholders numericos (%d, %f, %.Nf) son seguros. */
function verificarExecSinEscape(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (!/\b(exec|shell_exec|proc_open|system|passthru)\s*\(/.test(linea)) {
      continue;
    }

    /* --- Exclusion 1: $objeto->exec() es metodo de instancia (PDO, etc.), no shell ---
     * Patron: ->exec( o ::exec( indica invocacion de metodo, no funcion global.
     * self::$conexion->exec(), $pdo->exec(), static::exec() son todos PDO. */
    if (/->exec\s*\(|::.*exec\s*\(/.test(linea)) {
      continue;
    }

    /* --- Exclusion 2: Argumentos completamente literales ---
     * Si exec/shell_exec recibe solo strings literales (o ternario de literales),
     * no hay vector de inyeccion. Ej: shell_exec('which ffmpeg 2>/dev/null')
     * o shell_exec($esWin ? 'where ffmpeg' : 'which ffmpeg') */
    if (esComandoLiteral(linea)) {
      continue;
    }

    /* proc_open con array como primer argumento es seguro: cada elemento
     * se pasa como argv separado sin interpretacion del shell.
     * Detectar: proc_open($arrayVar, ... o proc_open(['cmd', ...], ... */
    const matchProcOpen = /\bproc_open\s*\(\s*(\$\w+|\[)/.exec(linea);
    if (matchProcOpen) {
      const primerArg = matchProcOpen[1];
      if (primerArg === '[') {
        continue;
      }
      if (primerArg.startsWith('$')) {
        let esArray = false;
        for (let j = Math.max(0, i - 20); j < i; j++) {
          const varEscapada = primerArg.replace('$', '\\$');
          if (new RegExp(`${varEscapada}\\s*=\\s*(\\[|array\\s*\\()`).test(lineas[j])) {
            esArray = true;
            break;
          }
          if (new RegExp(`array\\s+${varEscapada.replace('\\$', '\\$')}`).test(lineas[j])) {
            esArray = true;
            break;
          }
        }
        for (let j = Math.max(0, i - 30); j < i; j++) {
          if (/function\s+\w+\s*\(/.test(lineas[j])) {
            const firma = lineas.slice(j, Math.min(j + 5, lineas.length)).join(' ');
            const varEscapada = primerArg.replace('$', '\\$');
            if (new RegExp(`array\\s+${varEscapada}`).test(firma)) {
              esArray = true;
            }
            break;
          }
        }
        if (esArray) {
          continue;
        }
      }
    }

    /* Si la linea contiene escapeshellarg, esta ok */
    if (/escapeshellarg/.test(linea)) {
      continue;
    }

    /* --- Exclusion 3: Variable construida con sprintf + escapeshellarg ---
     * Patron comun: $cmd = sprintf('...%s...', escapeshellarg($x), ...); exec($cmd);
     * Buscar la asignacion de la variable en las 15 lineas anteriores y verificar
     * que todos los placeholders %s tienen escapeshellarg. */
    if (tieneEscapeEnSprintf(lineas, i)) {
      continue;
    }

    /* Verificar surrounding lines (ventana de +-2 lineas) */
    let tieneEscape = false;
    for (let j = Math.max(0, i - 2); j <= Math.min(lineas.length - 1, i + 2); j++) {
      if (/escapeshellarg/.test(lineas[j])) {
        tieneEscape = true;
        break;
      }
    }

    if (!tieneEscape) {
      violaciones.push({
        reglaId: 'exec-sin-escapeshellarg',
        mensaje: 'exec()/shell_exec() sin escapeshellarg(). Riesgo de inyeccion de comandos.',
        severidad: obtenerSeveridadRegla('exec-sin-escapeshellarg'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* Verifica si el argumento de exec/shell_exec es un comando completamente literal
 * (string hardcodeado o ternario de literales sin variables). */
function esComandoLiteral(linea: string): boolean {
  /* Patron: exec('literal') o shell_exec("literal") */
  if (/\b(?:exec|shell_exec|system|passthru)\s*\(\s*['"][^$]*['"]\s*[,)]/.test(linea)) {
    return true;
  }
  /* Patron: shell_exec($var ? 'literal' : 'literal') — ternario de literales */
  if (/\b(?:exec|shell_exec|system|passthru)\s*\([^)]*\?\s*['"][^$]*['"]\s*:\s*['"][^$]*['"]\s*\)/.test(linea)) {
    return true;
  }
  return false;
}

/* Verifica si la variable usada en exec() fue construida con sprintf + escapeshellarg
 * para todos los placeholders de tipo string (%s). Busca la asignacion en lineas previas. */
function tieneEscapeEnSprintf(lineas: string[], lineaExec: number): boolean {
  const lineaActual = lineas[lineaExec];

  /* Extraer nombre de la variable pasada a exec: exec($cmd, ...) */
  const matchVar = /\b(?:exec|shell_exec|system|passthru)\s*\(\s*(\$\w+)/.exec(lineaActual);
  if (!matchVar) {
    return false;
  }
  const varNombre = matchVar[1];
  const varEscapada = varNombre.replace('$', '\\$');

  /* Buscar la linea de asignacion: $cmd = sprintf(...) o $cmd = \sprintf(...) */
  for (let j = Math.max(0, lineaExec - 15); j < lineaExec; j++) {
    const patron = new RegExp(`${varEscapada}\\s*=\\s*\\\\?sprintf\\s*\\(`);
    if (!patron.test(lineas[j])) {
      continue;
    }

    /* Reconstruir el bloque completo del sprintf (puede ser multilinea) */
    let bloqueSprintf = '';
    for (let k = j; k < Math.min(lineas.length, j + 20); k++) {
      bloqueSprintf += lineas[k] + '\n';
      if (/;\s*$/.test(lineas[k].trim())) {
        break;
      }
    }

    /* Contar cuantos %s hay en el formato (requieren escapeshellarg) */
    const formatMatch = /sprintf\s*\(\s*(['"])([\s\S]*?)\1/.exec(bloqueSprintf);
    if (!formatMatch) {
      /* Si no hay formato string visible, intentar con heredoc o variable */
      continue;
    }
    const formato = formatMatch[2];
    const contadorPorcentajeS = (formato.match(/%s/g) || []).length;

    /* Contar cuantos escapeshellarg hay en los argumentos */
    const contadorEscape = (bloqueSprintf.match(/escapeshellarg/g) || []).length;

    /* Si todos los %s tienen escapeshellarg, es seguro.
     * Los %d, %f, %.Nf no necesitan escape (fuerzan tipo numerico). */
    if (contadorEscape >= contadorPorcentajeS) {
      return true;
    }
  }

  return false;
}

/* Detecta curl_exec sin verificacion de curl_error */
function verificarCurlSinVerificacion(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    if (!/curl_exec\s*\(/.test(lineas[i])) {
      continue;
    }

    /* Buscar curl_error en las siguientes 10 lineas */
    let tieneVerificacion = false;
    for (let j = i; j < Math.min(lineas.length, i + 11); j++) {
      if (/curl_error/.test(lineas[j])) {
        tieneVerificacion = true;
        break;
      }
    }

    if (!tieneVerificacion) {
      violaciones.push({
        reglaId: 'curl-sin-verificacion',
        mensaje: 'curl_exec() sin verificar curl_error(). Un fallo de red no lanza excepcion automaticamente.',
        severidad: obtenerSeveridadRegla('curl-sin-verificacion'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* Detecta archivos temporales sin cleanup en finally */
function verificarArchivosTemporalesSinFinally(texto: string, lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    if (!/tempnam\s*\(/.test(lineas[i])) {
      continue;
    }

    /* Buscar bloque finally con unlink en las siguientes 150 lineas (metodos con sideload pueden ser largos) */
    let tieneFinally = false;
    const bloqueRelevante = lineas.slice(i, Math.min(lineas.length, i + 150)).join('\n');
    if (/finally\s*\{[\s\S]*unlink/.test(bloqueRelevante)) {
      tieneFinally = true;
    }

    if (!tieneFinally) {
      violaciones.push({
        reglaId: 'temp-sin-finally',
        mensaje: 'Archivo temporal (tempnam) sin cleanup en bloque finally. Riesgo de acumulacion en /tmp.',
        severidad: obtenerSeveridadRegla('temp-sin-finally'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Detecta parametros de request HTTP usados sin sanitizar.
 * Busca $_GET/$_POST/$_REQUEST y $request->get_param() sin que el resultado
 * pase por sanitize_text_field, intval, absint, sanitize_email, etc.
 * Exclusiones: si la linea o las 3 siguientes contienen una funcion de sanitizacion.
 */
function verificarSanitizacionFaltante(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  const patronesInseguros = [
    /\$_GET\s*\[/,
    /\$_POST\s*\[/,
    /\$_REQUEST\s*\[/,
  ];

  const funcionesSanitizacion = /sanitize_text_field|sanitize_email|sanitize_file_name|sanitize_key|sanitize_title|sanitize_user|sanitize_url|absint|intval|floatval|wp_kses|esc_html|esc_attr|esc_url|esc_sql|wp_unslash|array_map.*sanitize|filter_var|filter_input|htmlspecialchars/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    for (const patron of patronesInseguros) {
      if (!patron.test(linea)) {
        continue;
      }

      /* Verificar si la misma linea ya tiene sanitizacion */
      if (funcionesSanitizacion.test(linea)) {
        continue;
      }

      /* Verificar en las 3 lineas siguientes por sanitizacion del valor asignado */
      const contextoSiguiente = lineas.slice(i + 1, Math.min(lineas.length, i + 4)).join('\n');
      if (funcionesSanitizacion.test(contextoSiguiente)) {
        continue;
      }

      /* Excluir si esta dentro de un comentario */
      const lineaTrimmed = linea.trim();
      if (lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/*')) {
        continue;
      }

      const superGlobal = patron.source.includes('GET') ? '$_GET' :
        patron.source.includes('POST') ? '$_POST' : '$_REQUEST';

      violaciones.push({
        reglaId: 'sanitizacion-faltante',
        mensaje: `${superGlobal} usado sin sanitizar. Aplicar sanitize_text_field(), intval() u otra funcion de sanitizacion.`,
        severidad: obtenerSeveridadRegla('sanitizacion-faltante'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
