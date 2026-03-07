/*
 * Reglas de seguridad PHP: ejecucion de comandos, curl, archivos temporales, sanitizacion.
 * Detecta: exec sin escapeshellarg, curl sin error check, tempnam sin finally, input sin sanitizar.
 */

import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { tieneSentinelDisable } from '../../utils/analisisHelpers';

/*
 * Detecta exec()/shell_exec() sin escapeshellarg().
 * Excluye:
 * - proc_open() con array como primer argumento (seguro por diseno: PHP 7.4+).
 * - $objeto->exec() (metodo de instancia como PDO::exec).
 * - Comandos 100% literales (strings hardcodeados o ternarios de literales).
 * - exec($cmd) donde $cmd se construyo con sprintf + escapeshellarg en todos los %s.
 */
export function verificarExecSinEscape(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (!/\b(exec|shell_exec|proc_open|system|passthru)\s*\(/.test(linea)) {
      continue;
    }

    /* Exclusion: $objeto->exec() o Clase::exec() — metodo de instancia, no shell */
    if (/->exec\s*\(|::.*exec\s*\(/.test(linea)) {
      continue;
    }

    /* Exclusion: argumentos completamente literales */
    if (esComandoLiteral(linea)) {
      continue;
    }

    /* proc_open con array como primer argumento es seguro (argv separado sin shell) */
    const matchProcOpen = /\bproc_open\s*\(\s*(\$\w+|\[)/.exec(linea);
    if (matchProcOpen) {
      const primerArg = matchProcOpen[1];
      if (primerArg === '[') {
        continue;
      }
      if (primerArg.startsWith('$') && esVariableArrayEnContexto(lineas, i, primerArg)) {
        continue;
      }
    }

    /* Exclusion: variable asignada desde literales en lineas cercanas */
    if (esVariableDesdeComandoLiteral(lineas, i)) {
      continue;
    }

    /* escapeshellarg en la misma linea */
    if (/escapeshellarg/.test(linea)) {
      continue;
    }

    /* Variable construida con sprintf + escapeshellarg para todos los %s */
    if (tieneEscapeEnSprintf(lineas, i)) {
      continue;
    }

    /* Ventana +-2 lineas para escapeshellarg */
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

/* Verifica si una variable es un array por contexto: declaracion o type hint */
function esVariableArrayEnContexto(lineas: string[], lineaActual: number, varNombre: string): boolean {
  const varEscapada = varNombre.replace('$', '\\$');

  /* Buscar asignacion a array en las 20 lineas previas */
  for (let j = Math.max(0, lineaActual - 20); j < lineaActual; j++) {
    if (new RegExp(`${varEscapada}\\s*=\\s*(\\[|array\\s*\\()`).test(lineas[j])) {
      return true;
    }
    if (new RegExp(`array\\s+${varEscapada}`).test(lineas[j])) {
      return true;
    }
  }

  /* Buscar type hint en firma de funcion */
  for (let j = Math.max(0, lineaActual - 30); j < lineaActual; j++) {
    if (/function\s+\w+\s*\(/.test(lineas[j])) {
      const firma = lineas.slice(j, Math.min(j + 5, lineas.length)).join(' ');
      if (new RegExp(`array\\s+${varEscapada}`).test(firma)) {
        return true;
      }
      break;
    }
  }

  return false;
}

/* Verifica si el argumento de exec/shell_exec es un comando completamente literal */
function esComandoLiteral(linea: string): boolean {
  if (/\b(?:exec|shell_exec|system|passthru)\s*\(\s*['"][^$]*['"]\s*[,)]/.test(linea)) {
    return true;
  }
  /* Ternario de literales: shell_exec($var ? 'literal' : 'literal') */
  if (/\b(?:exec|shell_exec|system|passthru)\s*\([^)]*\?\s*['"][^$]*['"]\s*:\s*['"][^$]*['"]\s*\)/.test(linea)) {
    return true;
  }
  return false;
}

/* Verifica si exec recibe una variable asignada desde strings literales en lineas cercanas */
function esVariableDesdeComandoLiteral(lineas: string[], lineaExec: number): boolean {
  const lineaActual = lineas[lineaExec];
  const matchVar = /\b(?:exec|shell_exec|system|passthru)\s*\(\s*(\$\w+)/.exec(lineaActual);
  if (!matchVar) { return false; }

  const varEscapada = matchVar[1].replace('$', '\\$');

  for (let j = Math.max(0, lineaExec - 10); j < lineaExec; j++) {
    const linea = lineas[j];
    /* $cmd = 'literal'; */
    if (new RegExp(`${varEscapada}\\s*=\\s*['"][^$]*['"]\\s*;`).test(linea)) {
      return true;
    }
    /* $cmd = $cond ? 'lit' : 'lit'; */
    if (new RegExp(`${varEscapada}\\s*=\\s*.*\\?\\s*['"][^$]*['"]\\s*:\\s*['"][^$]*['"]\\s*;`).test(linea)) {
      return true;
    }
  }
  return false;
}

/* Verifica si la variable usada en exec() fue construida con sprintf + escapeshellarg
 * para todos los placeholders %s. Los %d/%f son numericos y seguros. */
function tieneEscapeEnSprintf(lineas: string[], lineaExec: number): boolean {
  const lineaActual = lineas[lineaExec];
  const matchVar = /\b(?:exec|shell_exec|system|passthru)\s*\(\s*(\$\w+)/.exec(lineaActual);
  if (!matchVar) { return false; }

  const varEscapada = matchVar[1].replace('$', '\\$');

  for (let j = Math.max(0, lineaExec - 15); j < lineaExec; j++) {
    const patron = new RegExp(`${varEscapada}\\s*=\\s*\\\\?sprintf\\s*\\(`);
    if (!patron.test(lineas[j])) { continue; }

    /* Reconstruir bloque sprintf (puede ser multilinea) */
    let bloqueSprintf = '';
    for (let k = j; k < Math.min(lineas.length, j + 20); k++) {
      bloqueSprintf += lineas[k] + '\n';
      if (/;\s*$/.test(lineas[k].trim())) { break; }
    }

    /* Contar %s en el formato */
    const formatMatch = /sprintf\s*\(\s*(['"])([\s\S]*?)\1/.exec(bloqueSprintf);
    if (!formatMatch) { continue; }

    const contadorPorcentajeS = (formatMatch[2].match(/%s/g) || []).length;
    const contadorEscape = (bloqueSprintf.match(/escapeshellarg/g) || []).length;

    if (contadorEscape >= contadorPorcentajeS) {
      return true;
    }
  }

  return false;
}

/* Detecta curl_exec sin verificacion de curl_error */
export function verificarCurlSinVerificacion(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    if (!/curl_exec\s*\(/.test(lineas[i])) { continue; }

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
export function verificarArchivosTemporalesSinFinally(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    if (!/tempnam\s*\(/.test(lineas[i])) { continue; }

    const bloqueRelevante = lineas.slice(i, Math.min(lineas.length, i + 150)).join('\n');
    const tieneFinally = /finally\s*\{[\s\S]*unlink/.test(bloqueRelevante);

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
 * Busca $_GET/$_POST/$_REQUEST sin funcion de sanitizacion en linea o contexto cercano.
 */
export function verificarSanitizacionFaltante(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  const patronesInseguros: { patron: RegExp; nombre: string }[] = [
    { patron: /\$_GET\s*\[/, nombre: '$_GET' },
    { patron: /\$_POST\s*\[/, nombre: '$_POST' },
    { patron: /\$_REQUEST\s*\[/, nombre: '$_REQUEST' },
  ];

  const funcionesSanitizacion = /sanitize_text_field|sanitize_email|sanitize_file_name|sanitize_key|sanitize_title|sanitize_user|sanitize_url|absint|intval|floatval|wp_kses|esc_html|esc_attr|esc_url|esc_sql|wp_unslash|array_map.*sanitize|filter_var|filter_input|htmlspecialchars|wp_verify_nonce|is_numeric|is_array|is_int|is_float|\(int\)|\(float\)|\(bool\)/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Excluir comentarios */
    const lineaTrimmed = linea.trim();
    if (lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/*')) {
      continue;
    }

    for (const { patron, nombre } of patronesInseguros) {
      if (!patron.test(linea)) { continue; }

      /* Excluir si solo aparece dentro de isset()/empty() */
      if (esUsadoSoloEnExistencia(linea, nombre)) { continue; }

      /* Sanitizacion en la misma linea */
      if (funcionesSanitizacion.test(linea)) { continue; }

      /* Sanitizacion en las 3 lineas siguientes */
      const contextoSiguiente = lineas.slice(i + 1, Math.min(lineas.length, i + 4)).join('\n');
      if (funcionesSanitizacion.test(contextoSiguiente)) { continue; }

      violaciones.push({
        reglaId: 'sanitizacion-faltante',
        mensaje: `${nombre} usado sin sanitizar. Aplicar sanitize_text_field(), intval() u otra funcion de sanitizacion.`,
        severidad: obtenerSeveridadRegla('sanitizacion-faltante'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* Verifica si todas las ocurrencias de un superglobal estan dentro de isset()/empty() */
function esUsadoSoloEnExistencia(linea: string, superGlobal: string): boolean {
  const patronGlobal = superGlobal === '$_GET' ? /\$_GET\s*\[/g :
    superGlobal === '$_POST' ? /\$_POST\s*\[/g : /\$_REQUEST\s*\[/g;
  const totalOcurrencias = (linea.match(patronGlobal) || []).length;
  if (totalOcurrencias === 0) { return false; }

  const escapedGlobal = superGlobal.replace('$', '\\$');
  const dentroIsset = new RegExp(`(?:isset|!?empty)\\s*\\(\\s*${escapedGlobal}\\s*\\[`, 'g');
  const ocurrenciasSeguras = (linea.match(dentroIsset) || []).length;

  return ocurrenciasSeguras >= totalOcurrencias;
}

/*
 * Detecta uso de MIME type del cliente ($_FILES['...']['type'], $archivo['type'])
 * en validacion sin verificacion server-side (mime_content_type / finfo_file).
 * El MIME del cliente es spoofeable trivialmente.
 */
export function verificarMimeTypeCliente(lineas: string[]): Violacion[] {
    const violaciones: Violacion[] = [];
    const patronMimeCliente = /\$(?:_FILES\s*\[\s*['"][^'"]+['"]\s*\]\s*\[\s*['"]type['"]\s*\]|(?:archivo|file|upload)\w*\s*\[\s*['"]type['"]\s*\])/;

    for (let i = 0; i < lineas.length; i++) {
        if (tieneSentinelDisable(lineas, i, 'mime-type-cliente')) { continue; }
        if (!patronMimeCliente.test(lineas[i])) { continue; }

        /* Buscar mime_content_type o finfo_ en el mismo metodo (+-50 lineas) */
        let tieneVerificacionServer = false;
        for (let j = Math.max(0, i - 30); j < Math.min(lineas.length, i + 50); j++) {
            if (/\b(mime_content_type|finfo_file|finfo_open|wp_check_filetype_and_ext|wp_check_filetype)\b/.test(lineas[j])) {
                tieneVerificacionServer = true;
                break;
            }
        }

        if (!tieneVerificacionServer) {
            violaciones.push({
                reglaId: 'mime-type-cliente',
                mensaje: 'Validacion MIME usa tipo reportado por el cliente. Spoofeable. Usar mime_content_type() o finfo_file().',
                severidad: obtenerSeveridadRegla('mime-type-cliente'),
                linea: i,
                fuente: 'estatico',
                sugerencia: 'Reemplazar con wp_check_filetype_and_ext() o finfo_file(finfo_open(FILEINFO_MIME_TYPE), $path).',
            });
        }
    }

    return violaciones;
}
