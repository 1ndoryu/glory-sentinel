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

    /* Buscar try como primera instruccion significativa */
    if (primeraInstruccion && linea !== '' && linea !== '{') {
      if (linea.startsWith('try')) {
        tieneTryCatch = true;
      }
      primeraInstruccion = false;
    }

    /* Metodo terminado */
    if (llaves <= 0 && !primeraInstruccion) {
      if (!tieneTryCatch && nombreMetodo && !esMetodoExcluido(nombreMetodo)) {
        /* Excluir metodos triviales (getters, <5 lineas efectivas) */
        const esMetodoTrivial = contarLineasMetodo(lineas, lineaMetodo, i) < 5;
        if (!esMetodoTrivial) {
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

/* Detecta json_decode() sin verificacion de errores */
function verificarJsonDecodeInseguro(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    if (!/json_decode\s*\(/.test(lineas[i])) {
      continue;
    }

    /* Buscar json_last_error en las siguientes 5 lineas */
    let tieneVerificacion = false;
    for (let j = i; j < Math.min(lineas.length, i + 6); j++) {
      if (/json_last_error/.test(lineas[j])) {
        tieneVerificacion = true;
        break;
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
 * Excluye proc_open() con array como primer argumento (seguro por diseno:
 * PHP 7.4+ ejecuta cada elemento como argv separado, sin pasar por shell). */
function verificarExecSinEscape(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (!/\b(exec|shell_exec|proc_open|system|passthru)\s*\(/.test(linea)) {
      continue;
    }

    /* proc_open con array como primer argumento es seguro: cada elemento
     * se pasa como argv separado sin interpretacion del shell.
     * Detectar: proc_open($arrayVar, ... o proc_open(['cmd', ...], ... */
    const matchProcOpen = /\bproc_open\s*\(\s*(\$\w+|\[)/.exec(linea);
    if (matchProcOpen) {
      const primerArg = matchProcOpen[1];
      /* Si el argumento es un array literal, es seguro */
      if (primerArg === '[') {
        continue;
      }
      /* Si es una variable, buscar si fue definida como array en lineas cercanas */
      if (primerArg.startsWith('$')) {
        let esArray = false;
        for (let j = Math.max(0, i - 20); j < i; j++) {
          const varEscapada = primerArg.replace('$', '\\$');
          /* Buscar asignacion de array: $var = [...] o $var = array(...) */
          if (new RegExp(`${varEscapada}\\s*=\\s*(\\[|array\\s*\\()`).test(lineas[j])) {
            esArray = true;
            break;
          }
          /* Buscar declaracion de tipo array: array $var */
          if (new RegExp(`array\\s+${varEscapada.replace('\\$', '\\$')}`).test(lineas[j])) {
            esArray = true;
            break;
          }
        }
        /* Tambien verificar parametros de la funcion actual con tipo array */
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

    /* Verificar surrounding lines */
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
