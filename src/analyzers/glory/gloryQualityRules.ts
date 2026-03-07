/*
 * Reglas de calidad de codigo PHP especificas del framework Glory.
 * Detecta: return void en metodos criticos, N+1 queries,
 * FQN inline, funciones publicas sin return type.
 */

import * as path from 'path';
import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';

/*
 * Detecta metodos publicos que hacen INSERT/UPDATE/DELETE pero retornan void.
 * El caller no puede verificar si la operacion financiera/de estado se guardo.
 */
export function verificarReturnVoidCritico(texto: string, lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  const regexMetodoPublico = /public\s+function\s+(\w+)\s*\([^)]*\)\s*(?::\s*(\w+))?\s*\{/g;

  let match: RegExpExecArray | null;
  while ((match = regexMetodoPublico.exec(texto)) !== null) {
    const nombreMetodo = match[1];
    const returnType = match[2] || null;

    if (returnType !== null && returnType !== 'void') { continue; }

    const posicion = match.index;
    const lineaSignature = texto.substring(0, posicion).split('\n').length - 1;

    if (tieneSentinelDisable(lineas, lineaSignature, 'return-void-critico')) { continue; }

    /* Encontrar el cuerpo del metodo */
    const inicioBody = texto.indexOf('{', posicion + match[0].length - 1);
    if (inicioBody === -1) { continue; }

    let profundidad = 1;
    let pos = inicioBody + 1;
    while (pos < texto.length && profundidad > 0) {
      if (texto[pos] === '{') { profundidad++; }
      else if (texto[pos] === '}') { profundidad--; }
      pos++;
    }

    const cuerpo = texto.substring(inicioBody, pos);

    if (/^(__construct|register(Routes)?|registrar(Rutas)?)$/i.test(nombreMetodo)) { continue; }

    const tieneEscritura = /\b(INSERT|UPDATE|DELETE|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE|->insertar\(|->actualizar\(|->eliminar\(|->insert\(|->update\(|->delete\(|->query\(.*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP))/i.test(cuerpo);

    if (tieneEscritura) {
      /* Si el metodo no tiene `: void` explicito, verificar si tiene return con valor */
      if (returnType === null) {
        const tieneReturnConValor = /\breturn\s+[^;]+;/.test(cuerpo);
        if (tieneReturnConValor) { continue; }
      }

      const tipoActual = returnType === 'void' ? 'void' : 'sin return type';
      violaciones.push({
        reglaId: 'return-void-critico',
        mensaje: `Metodo '${nombreMetodo}()' hace operaciones de escritura pero retorna ${tipoActual}. El caller no puede verificar exito/fallo.`,
        severidad: obtenerSeveridadRegla('return-void-critico'),
        linea: lineaSignature,
        sugerencia: 'Cambiar return type a bool o un tipo que indique resultado de la operacion.',
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Detecta queries dentro de loops (foreach, for, while) — patron N+1.
 * Excluye si hay cache en el cuerpo del loop.
 */
export function verificarNPlus1Query(lineas: string[], rutaArchivo?: string): Violacion[] {
  const violaciones: Violacion[] = [];

  const regexLoop = /\b(foreach|for|while)\s*\(/;
  const regexQuery = /(\$this->pg|\$wpdb->|->ejecutar\(|->buscarPorId\(|->get_results\(|->get_var\(|->get_row\(|->query\()/;
  const regexCache = /(\$cache|wp_cache_get|cache_get|Redis::|Memcached::|static\s+\$cache)/;

  const lineasYaReportadas = new Set<number>();

  const nombreArchivo = path.basename(rutaArchivo || '');
  if (/Seeder/i.test(nombreArchivo)) { return violaciones; }

  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i])) { continue; }
    if (!regexLoop.test(lineas[i])) { continue; }
    if (tieneSentinelDisable(lineas, i, 'n-plus-1-query')) { continue; }

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

    if (finBloque > i) { i = finBloque; }
  }

  return violaciones;
}

/*
 * Detecta Fully Qualified Names inline (\App\, \Glory\) en vez de use statements.
 */
export function verificarFqnInline(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  let pasadoUseStatements = false;

  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i])) { continue; }

    const lineaTrimmed = lineas[i].trim();
    if (/^(class |abstract\s+class |final\s+class |function |namespace )/.test(lineaTrimmed)) {
      pasadoUseStatements = true;
    }

    if (/^namespace\s+/.test(lineaTrimmed)) { continue; }
    if (!pasadoUseStatements) { continue; }
    if (tieneSentinelDisable(lineas, i, 'controller-fqn-inline')) { continue; }

    if (/\\(App|Glory)\\/.test(lineas[i])) {
      if (/^use\s+/.test(lineaTrimmed)) { continue; }
      if (/['"]\/?(App|Glory)\//.test(lineas[i])) { continue; }
      if (/instanceof/.test(lineas[i])) { continue; }
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

/*
 * Detecta funciones publicas sin return type declaration.
 * Excluye metodos magicos (__construct, etc.) y los que tienen @return en docblock.
 */
export function verificarPhpSinReturnType(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    if (tieneSentinelDisable(lineas, i, 'php-sin-return-type')) { continue; }

    const match = /public\s+function\s+(\w+)\s*\([^)]*\)\s*\{/.exec(lineas[i]);
    if (!match) { continue; }

    const nombre = match[1];
    if (/^(__construct|__destruct|__clone|__toString|__get|__set|__isset|__unset|setUp|tearDown)$/.test(nombre)) {
      continue;
    }

    if (/\)\s*:\s*\S+\s*\{/.test(lineas[i])) { continue; }

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
