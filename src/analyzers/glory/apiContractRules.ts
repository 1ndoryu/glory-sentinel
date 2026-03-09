/*
 * Reglas de contrato API: detectan desajustes entre
 * lo que PHP devuelve y lo que TypeScript consume.
 *
 * Regla 1: api-response-mismatch
 *   Cruza claves del generic de fetchAdmin con el indice PHP.
 *   "La clave 'X' no existe en la respuesta PHP de '/admin/Y'."
 *
 * Regla 2: acceso-api-sin-fallback
 *   Detecta setState(data.campo) sin ?? fallback.
 *   "data.campo puede ser undefined si la API no lo incluye."
 */

import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';
import { buscarContratoPorSlug, obtenerContratos } from './apiContractIndexer';

/*
 * Detecta mismatch entre las claves que TS espera y las que PHP devuelve.
 *
 * Patron detectado:
 *   fetchAdmin<{ success: boolean; campo: Type }>('endpoint')
 *
 * Extrae:
 *   - endpoint del primer argumento string
 *   - claves del tipo generico (excluyendo 'success')
 *
 * Cruza con el indice PHP para verificar que las claves existen.
 */
export function verificarApiResponseMismatch(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  const contratos = obtenerContratos();
  if (!contratos || contratos.size === 0) { return violaciones; }

  /*
   * Regex para capturar:
   *   fetchAdmin<{ ...campos... }>('endpoint')
   *   fetchAdmin<{ ...campos... }>(`endpoint`)
   *
   * Grupo 1: contenido del generic <{...}>
   * Grupo 2: endpoint string
   */
  const regexFetch = /fetch\w*<\{([^}]+)\}>\s*\(\s*['"`]([^'"`]+)['"`]/;

  /*
   * Regex alternativo para patrones con await y tipo inline:
   *   await fetch(.../glory/v1/admin/endpoint...)
   *   const data: { campo: Type } = await res.json()
   *
   * Pero el patron principal del proyecto es fetchAdmin<Generic>('slug')
   */

  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i])) { continue; }
    if (tieneSentinelDisable(lineas, i, 'api-response-mismatch')) { continue; }

    const match = regexFetch.exec(lineas[i]);
    if (!match) { continue; }

    const genericContent = match[1];
    const endpoint = match[2];

    /* Extraer claves del generic (e.g. "success: boolean; campo: Type") */
    const clavesTs = new Set<string>();
    const regexClave = /(\w+)\s*:/g;
    let m: RegExpExecArray | null;
    while ((m = regexClave.exec(genericContent)) !== null) {
      if (m[1] !== 'success') {
        clavesTs.add(m[1]);
      }
    }

    if (clavesTs.size === 0) { continue; }

    /* Buscar contrato PHP por slug */
    const contrato = buscarContratoPorSlug(endpoint);
    if (!contrato) { continue; }

    /* Claves PHP (sin 'success') */
    const clavesPhp = new Set<string>();
    for (const c of contrato.claves) {
      if (c !== 'success') { clavesPhp.add(c); }
    }

    /* Detectar claves esperadas en TS pero ausentes en PHP */
    for (const claveTs of clavesTs) {
      if (!clavesPhp.has(claveTs)) {
        const disponibles = [...clavesPhp].join(', ');
        violaciones.push({
          reglaId: 'api-response-mismatch',
          mensaje: `Clave '${claveTs}' no existe en la respuesta PHP del endpoint '${contrato.ruta}'. ` +
            `Claves disponibles: ${disponibles || '(ninguna indexada)'}.`,
          severidad: obtenerSeveridadRegla('api-response-mismatch'),
          linea: i,
          sugerencia: `Verificar que el controller PHP devuelva '${claveTs}' en WP_REST_Response, ` +
            `o corregir el nombre de la clave en el tipo generico del fetch.`,
          fuente: 'estatico',
        });
      }
    }

    /* Detectar claves devueltas por PHP pero no leidas en TS (informativo) */
    for (const clavePHP of clavesPhp) {
      if (!clavesTs.has(clavePHP)) {
        violaciones.push({
          reglaId: 'api-response-mismatch',
          mensaje: `PHP devuelve '${clavePHP}' en '${contrato.ruta}' pero no se declara en el tipo generico. ` +
            `Si se accede a data.${clavePHP}, no tendra tipo seguro.`,
          severidad: 'information',
          linea: i,
          sugerencia: `Agregar '${clavePHP}: TipoEsperado' al tipo generico del fetch.`,
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/*
 * Detecta acceso a propiedades de respuesta API sin fallback defensivo.
 *
 * Patron peligroso:
 *   if (data) setX(data.campo)          → crash si campo es undefined
 *   if (data) setX(data.campo)          → crash si campo.length en render
 *
 * Patron correcto:
 *   if (data) setX(data.campo ?? [])    → fallback seguro
 *   if (data) setX(data.campo ?? null)
 *
 * Solo aplica cuando el setter espera un array (estado inicializado con []).
 */
export function verificarAccesoApiSinFallback(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /*
   * Regex para capturar:
   *   setAlgo(data.campo)        → sin fallback
   *   setAlgo(data.campo ?? [])  → con fallback (OK)
   *   setAlgo(data?.campo)       → con optional chaining pero sin fallback
   *
   * El regex busca: set + PascalCase ( data . campo ) sin ?? despues
   */
  const regexSetterSinFallback = /\bset\w+\(\s*data\??\.\w+\s*\)/;
  const regexConFallback = /\bset\w+\(\s*data\??\.(\w+)\s*\?\?\s*/;
  const regexSetter = /\bset(\w+)\(\s*data\??\.(\w+)/;

  /*
   * Recopilar estados inicializados con [] (arrays).
   * Patron: useState<Type[]>([])  o  useState([])
   */
  const estadosArray = new Set<string>();
  const regexUseState = /\[\s*(\w+)\s*,\s*set(\w+)\s*\]\s*=\s*useState[^(]*\(\s*\[\s*\]\s*\)/;

  for (let i = 0; i < lineas.length; i++) {
    const matchState = regexUseState.exec(lineas[i]);
    if (matchState) {
      estadosArray.add(matchState[2]); /* nombre del setter sin 'set' prefix */
    }
  }

  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i])) { continue; }
    if (tieneSentinelDisable(lineas, i, 'acceso-api-sin-fallback')) { continue; }

    const linea = lineas[i];

    /* Si ya tiene fallback (??) — OK */
    if (regexConFallback.test(linea)) { continue; }

    /* Si tiene el patron de setter sin fallback */
    if (!regexSetterSinFallback.test(linea)) { continue; }

    const matchSet = regexSetter.exec(linea);
    if (!matchSet) { continue; }

    const nombreSetter = matchSet[1]; /* e.g. 'Actividad' */
    const campo = matchSet[2];        /* e.g. 'actividad' */

    /* Solo reportar si el estado fue inicializado como array.
     * Si se setea un estado que no es array (e.g. estadisticas que es objeto|null),
     * el fallback no es necesario — null es un valor valido. */
    if (!estadosArray.has(nombreSetter)) { continue; }

    /* Verificar que no este en una linea que ya tiene ?? en algun punto */
    if (linea.includes('??')) { continue; }

    violaciones.push({
      reglaId: 'acceso-api-sin-fallback',
      mensaje: `set${nombreSetter}(data.${campo}) sin fallback — si la API no incluye '${campo}', ` +
        `el estado recibirá undefined y cualquier .length/.map() fallara en el render.`,
      severidad: obtenerSeveridadRegla('acceso-api-sin-fallback'),
      linea: i,
      sugerencia: `Agregar fallback: set${nombreSetter}(data.${campo} ?? [])`,
      fuente: 'estatico',
    });
  }

  return violaciones;
}
