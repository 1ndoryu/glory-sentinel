import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';

/*
 * Detecta acceso a propiedades de respuesta API sin fallback defensivo.
 *
 * Patron peligroso:
 *   if (data) setX(data.campo) -> crash si campo es undefined
 *
 * Patron correcto:
 *   if (data) setX(data.campo ?? [])
 *   if (data) setX(data.campo ?? null)
 *
 * Solo aplica cuando el setter espera un array (estado inicializado con []).
 */
export function verificarAccesoApiSinFallback(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /*
   * Regex para capturar:
   *   setAlgo(data.campo)       -> sin fallback
   *   setAlgo(data.campo ?? []) -> con fallback (OK)
   *   setAlgo(data?.campo)      -> con optional chaining pero sin fallback
   */
  const regexSetterSinFallback = /\bset\w+\(\s*data\??\.\w+\s*\)/;
  const regexConFallback = /\bset\w+\(\s*data\??\.(\w+)\s*\?\?\s*/;
  const regexSetter = /\bset(\w+)\(\s*data\??\.(\w+)/;

  /*
   * Recopilar estados inicializados con [] (arrays).
   * Patron: useState<Type[]>([]) o useState([])
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

    /* Si ya tiene fallback (??) - OK */
    if (regexConFallback.test(linea)) { continue; }

    /* Si tiene el patron de setter sin fallback */
    if (!regexSetterSinFallback.test(linea)) { continue; }

    const matchSet = regexSetter.exec(linea);
    if (!matchSet) { continue; }

    const nombreSetter = matchSet[1]; /* e.g. 'Actividad' */
    const campo = matchSet[2];        /* e.g. 'actividad' */

    /* Solo reportar si el estado fue inicializado como array.
     * Si se setea un estado que no es array (e.g. estadisticas que es objeto|null),
     * el fallback no es necesario; null es un valor valido. */
    if (!estadosArray.has(nombreSetter)) { continue; }

    /* Verificar que no este en una linea que ya tiene ?? en algun punto */
    if (linea.includes('??')) { continue; }

    violaciones.push({
      reglaId: 'acceso-api-sin-fallback',
      mensaje: `set${nombreSetter}(data.${campo}) sin fallback - si la API no incluye '${campo}', ` +
        `el estado recibira undefined y cualquier .length/.map() fallara en el render.`,
      severidad: obtenerSeveridadRegla('acceso-api-sin-fallback'),
      linea: i,
      sugerencia: `Agregar fallback: set${nombreSetter}(data.${campo} ?? [])`,
      fuente: 'estatico',
    });
  }

  return violaciones;
}
