/* Analizador estático (ejecución de reglas que analizan el documento completo.) Extraído de staticAnalyzer.ts. */
import { ReglaEstatica, Violacion } from '../../../types';
import { CoreTextDocument, positionAtOffset } from '../../../core/runtime-proyecto/types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';

/*
 * Ejecuta una regla regex contra el archivo completo.
 * Util para patrones multilinea como catch vacio.
 */
export function ejecutarReglaCompleta(
    texto: string,
    regla: ReglaEstatica,
    documento: CoreTextDocument,
    deshabilitadasEnArchivo: Set<string>,
): Violacion[] {
    const violaciones: Violacion[] = [];

    if (deshabilitadasEnArchivo.has(regla.id)) {
        return violaciones;
    }

    const patron = new RegExp(regla.patron.source, regla.patron.flags + (regla.patron.flags.includes('g') ? '' : 'g'));

    let match: RegExpExecArray | null;
    while ((match = patron.exec(texto)) !== null) {
        const posicion = positionAtOffset(documento, match.index);
        const posicionFin = positionAtOffset(documento, match.index + match[0].length);

        if (posicion.line > 0) {
            const lineaAnterior = documento.lineAt(posicion.line - 1).text;
            if (lineaAnterior.includes(`sentinel-disable-next-line ${regla.id}`)) {
                continue;
            }
        }

        let mensaje = regla.mensaje;
        if (match[1]) {
            mensaje = mensaje.replace('$1', match[1]);
        }

        violaciones.push({
            reglaId: regla.id,
            mensaje,
            severidad: obtenerSeveridadRegla(regla.id),
            linea: posicion.line,
            lineaFin: posicionFin.line,
            columna: posicion.character,
            columnaFin: posicionFin.character,
            quickFixId: regla.quickFixId,
            fuente: 'estatico'
        });
    }

    return violaciones;
}
