/* Directivas sentinel-disable (linea y archivo) y deteccion de comentarios. Extraido de src/utils/analisisHelpers.ts (fachada). */
/*
 * Retorna true si la linea es un comentario (PHP, JS/TS, CSS).
 * Cubre: //, #, /*, *, docblocks (/**).
 */
export function esComentario(linea: string): boolean {
  const trim = linea.trim();
  return (
    trim.startsWith('//') ||
    trim.startsWith('*') ||
    trim.startsWith('/*') ||
    trim.startsWith('#')
  );
}

/* Retorna true si alguna de las 5 lineas previas a `indice` contiene
 * `sentinel-disable-next-line <reglaId>`, sin importar que haya lineas de
 * codigo entre el disable y la linea reportada.
 * El scan atraviesa lineas vacias, comentarios (/* ... *\/ // ...) y codigo:
 * en JSX el disable suele colocarse sobre el bloque contenedor mientras la
 * regla reporta una linea interna (ej: disable sobre <div>, violacion en el
 * <h3> de dentro — caso SeccionPagos [259A-5]). La ventana de 5 lineas acota
 * el alcance: un disable a 6+ lineas no suprime nada.
 * [25A-SENT-FP] Los bloques de comentario multi-linea siguen cubiertos porque
 * el scan no se detiene en lineas intermedias. */
export function tieneSentinelDisable(lineas: string[], indice: number, reglaId: string): boolean {
  for (let k = indice - 1; k >= 0 && k >= indice - 5; k--) {
    const linea = lineas[k] ?? '';
    if (linea.includes(`sentinel-disable-next-line ${reglaId}`)) { return true; }
  }
  return false;
}

/* Separadores validos entre ids en un `sentinel-disable-file` multi-regla:
 * `/* sentinel-disable-file regla-a regla-b: motivo *\/ */
const SEPARADORES_DISABLE_FILE = /[\s:;,(){}[\]"'`]+/;

/* Retorna true si el texto contiene `sentinel-disable-file <reglaId>` con el
 * id como token exacto en su misma linea. El match por token evita la
 * supresion cruzada por substring: deshabilitar `componente-sin-hook-glory`
 * no debe eximir `componente-sin-hook` ni viceversa (caso DeploymentRow /
 * PlanFeatureTooltip [259A-5], antes vivos por accidente). Un `sentinel-disable-file`
 * sin ids (bare) no exime ninguna regla. */
export function tieneSentinelDisableFile(texto: string, reglaId: string): boolean {
  const prefijo = 'sentinel-disable-file';
  let desde = 0;
  /* [289A-1] Sin while(true): no-constant-condition dejaba lint en rojo y
   * bloqueaba la certificacion del release. Misma semantica. */
  let idx = texto.indexOf(prefijo, desde);
  while (idx >= 0) {
    const finLinea = texto.indexOf('\n', idx);
    const segmento = texto.slice(idx + prefijo.length, finLinea < 0 ? undefined : finLinea);
    const tokens = segmento.split(SEPARADORES_DISABLE_FILE).filter(Boolean);
    if (tokens.includes(reglaId)) { return true; }
    desde = idx + prefijo.length;
    idx = texto.indexOf(prefijo, desde);
  }
  return false;
}
