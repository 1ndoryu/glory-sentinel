/* Analizador estático (directivas sentinel-disable-file por archivo.) Parseo compartido en utils/analisis/sentinelDisable. */
import { reglasDisableFileEnLinea } from '../../../utils/analisis/sentinelDisable';

export { tieneSentinelDisableFile } from '../../../utils/analisis/sentinelDisable';

/* Reglas listadas tras `sentinel-disable-file` en cualquier linea del documento. */
export function reglasDeshabilitadasEnArchivo(lineas: string[]): Set<string> {
    return new Set(lineas.flatMap(reglasDisableFileEnLinea));
}
