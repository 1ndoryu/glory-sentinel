/*
 * Reglas de mutabilidad de estado y datos compartidos: mutacion directa,
 * update optimista sin rollback, colas sin limite y objetos mutables exportados.
 * Agrupadas porque todas vigilan que un dato no cambie por efecto lateral.
 */

import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable, tieneSentinelDisableFile } from '../../../utils/analisisHelpers';

/*
 * Detecta mutaciones directas de estado React.
 * Busca .splice(), .push(), .pop() en variables que parezcan estado.
 */
export function verificarMutacionDirectaEstado(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  const nombresEstado = new Set<string>();
  for (const linea of lineas) {
    const match = /\[\s*(\w+)\s*,\s*set\w+\s*\]\s*=\s*useState/.exec(linea);
    if (match) {
      nombresEstado.add(match[1]);
    }
  }

  if (nombresEstado.size === 0) { return violaciones; }

  /* [259A-5] Contrato disable uniforme: file-level + next-line. */
  const texto = lineas.join('\n');
  if (tieneSentinelDisableFile(texto, 'mutacion-directa-estado')) { return []; }

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'mutacion-directa-estado')) { continue; }

    for (const nombre of nombresEstado) {
      const regexMutacion = new RegExp(`\\b${nombre}\\s*\\.\\s*(push|splice|pop|shift|unshift|reverse|sort|fill)\\s*\\(`);
      if (regexMutacion.test(linea)) {
        violaciones.push({
          reglaId: 'mutacion-directa-estado',
          mensaje: `Mutacion directa en estado "${nombre}" con .${RegExp.$1}(). Usar spread/map para inmutabilidad.`,
          severidad: obtenerSeveridadRegla('mutacion-directa-estado'),
          linea: i,
          fuente: 'estatico',
        });
      }

      const regexAsignacion = new RegExp(`\\b${nombre}\\s*\\[`);
      if (regexAsignacion.test(linea) && /=\s*(?!=)/.test(linea.substring(linea.indexOf(nombre)))) {
        const despuesDeCorchete = linea.substring(linea.indexOf(nombre));
        if (/\]\s*=[^=]/.test(despuesDeCorchete)) {
          violaciones.push({
            reglaId: 'mutacion-directa-estado',
            mensaje: `Asignacion directa a "${nombre}[i]". Usar map() + spread para inmutabilidad.`,
            severidad: obtenerSeveridadRegla('mutacion-directa-estado'),
            linea: i,
            fuente: 'estatico',
          });
        }
      }
    }
  }

  return violaciones;
}

/*
 * Detecta update optimista (set() antes de await) sin rollback en catch.
 * Si la API falla, el UI queda mostrando el estado optimista sin revertir.
 */
export function verificarUpdateOptimistaSinRollback(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* [259A-5] File-level para coherencia con el resto del contrato disable. */
  const textoOptimista = lineas.join('\n');
  if (tieneSentinelDisableFile(textoOptimista, 'update-optimista-sin-rollback')) { return []; }

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (!/\bset\s*\(\s*(?:\{|(?:prev|state|s)\s*=>)/.test(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'update-optimista-sin-rollback')) { continue; }

    /* Buscar un await en las siguientes 10 lineas */
    let lineaAwait = -1;
    for (let j = i + 1; j < Math.min(lineas.length, i + 10); j++) {
      if (/\bawait\b/.test(lineas[j])) {
        lineaAwait = j;
        break;
      }
    }

    if (lineaAwait === -1) { continue; }

    /* Buscar catch block despues del await */
    for (let j = lineaAwait; j < Math.min(lineas.length, lineaAwait + 30); j++) {
      if (!/\bcatch\s*\(/.test(lineas[j])) { continue; }

      let tieneRollback = false;
      let profundidad = 0;
      let dentroBloque = false;

      for (let k = j; k < Math.min(lineas.length, j + 20); k++) {
        for (const c of lineas[k]) {
          if (c === '{') { profundidad++; dentroBloque = true; }
          if (c === '}' && dentroBloque) { profundidad--; }
        }
        if (/\bset\s*\(/.test(lineas[k])) {
          tieneRollback = true;
          break;
        }
        if (dentroBloque && profundidad === 0) { break; }
      }

      if (!tieneRollback) {
        violaciones.push({
          reglaId: 'update-optimista-sin-rollback',
          mensaje: 'Update optimista: set() antes de await sin rollback en catch. Si la API falla, el UI queda inconsistente.',
          severidad: obtenerSeveridadRegla('update-optimista-sin-rollback'),
          linea: i,
          sugerencia: 'Guardar valor previo antes del set() optimista y restaurarlo en catch: catch(e) { set(valorPrevio); }',
          fuente: 'estatico',
        });
      }
      break;
    }
  }

  return violaciones;
}

/*
 * Detecta .push() a arrays de cola/buffer sin verificar limite de tamano.
 * Un array que crece sin control puede causar memory leaks.
 */
export function verificarColaSinLimite(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  const patronCola = /\b(\w*(?:cola|queue|buffer|pending|batch|stack))\s*\.\s*push\s*\(/i;

  /* [259A-5] File-level para coherencia con el resto del contrato disable. */
  const textoCola = lineas.join('\n');
  if (tieneSentinelDisableFile(textoCola, 'cola-sin-limite')) { return []; }

  for (let i = 0; i < lineas.length; i++) {
    if (tieneSentinelDisable(lineas, i, 'cola-sin-limite')) { continue; }
    if (esComentario(lineas[i])) { continue; }

    const match = patronCola.exec(lineas[i]);
    if (!match) { continue; }

    const nombreVar = match[1];

    /* Buscar .length check en las 5 lineas anteriores */
    let tieneCheckLimite = false;
    for (let j = Math.max(0, i - 5); j < i; j++) {
      if (new RegExp(`${nombreVar}\\.length`).test(lineas[j]) ||
          /\bMAX_|MAX_SIZE|LIMITE|CAPACITY/i.test(lineas[j])) {
        tieneCheckLimite = true;
        break;
      }
    }

    if (!tieneCheckLimite) {
      violaciones.push({
        reglaId: 'cola-sin-limite',
        mensaje: `"${nombreVar}.push()" sin verificar tamano. Un array que crece sin control causa memory leaks.`,
        severidad: obtenerSeveridadRegla('cola-sin-limite'),
        linea: i,
        fuente: 'estatico',
        sugerencia: `Agregar check de limite: if (${nombreVar}.length < MAX_SIZE) { ${nombreVar}.push(...) }`,
      });
    }
  }

  return violaciones;
}

/*
 * Detecta export const de objetos/arrays mutables al nivel de modulo.
 * Estos se comparten entre todos los importadores y sus mutaciones
 * generan efectos laterales dificiles de rastrear.
 */
export function verificarObjetoMutableExportado(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  const patronExportMutable = /^export\s+const\s+(\w+)\s*(?::\s*\w[^=]*)?\s*=\s*(\{|\[)/;

  /* [259A-5] File-level para coherencia con el resto del contrato disable. */
  const textoObjeto = lineas.join('\n');
  if (tieneSentinelDisableFile(textoObjeto, 'objeto-mutable-exportado')) { return []; }

  for (let i = 0; i < lineas.length; i++) {
    if (tieneSentinelDisable(lineas, i, 'objeto-mutable-exportado')) { continue; }
    if (esComentario(lineas[i])) { continue; }

    const match = patronExportMutable.exec(lineas[i].trim());
    if (!match) { continue; }

    const nombre = match[1];

    /* Excluir patrones comunes que son intencionalmente mutables (ej: registros, maps, definiciones de bloque) */
    if (/REGISTRO|registry|MAPA|Definition/i.test(nombre)) { continue; }

    /* Verificar si el bloque exportado es inmutable.
     * [044A-14] Escanea hasta el cierre del bloque (o nueva declaracion) en vez de solo 5 lineas,
     * para detectar as const satisfies al final de objetos grandes. */
    let esInmutable = false;
    if (/readonly/.test(lineas[i])) {
      esInmutable = true;
    } else {
      const limiteLineas = Math.min(lineas.length, i + 100);
      for (let j = i; j < limiteLineas; j++) {
        if (/Object\.freeze/.test(lineas[j]) || /as\s+const/.test(lineas[j])) {
          esInmutable = true;
          break;
        }
        /* Si encontramos otra declaracion top-level, el bloque export termino */
        if (j > i && /^(export\s|function\s|class\s|interface\s|type\s)/.test(lineas[j].trim())) {
          break;
        }
      }
    }

    if (!esInmutable) {
      violaciones.push({
        reglaId: 'objeto-mutable-exportado',
        mensaje: `"export const ${nombre}" exporta un ${match[2] === '{' ? 'objeto' : 'array'} mutable. Mutaciones afectan a todos los importadores.`,
        severidad: obtenerSeveridadRegla('objeto-mutable-exportado'),
        linea: i,
        fuente: 'estatico',
        sugerencia: `Usar "as const", Object.freeze(), o una funcion factory: export const get${nombre} = () => (${match[2] === '{' ? '{ ... }' : '[ ... ]'}).`,
      });
    }
  }

  return violaciones;
}
