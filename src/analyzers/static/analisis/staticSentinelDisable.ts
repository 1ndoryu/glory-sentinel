/* Analizador estático (directivas sentinel-disable-file por archivo.) Extraído de staticAnalyzer.ts. */

/* Reglas listadas tras `sentinel-disable-file` en cualquier linea del documento. */
export function reglasDeshabilitadasEnArchivo(lineas: string[]): Set<string> {
    const reglas = new Set<string>();

    for (const linea of lineas) {
        const indice = linea.indexOf('sentinel-disable-file');
        if (indice === -1) {
            continue;
        }

        const resto = linea
            .slice(indice + 'sentinel-disable-file'.length)
            .replace(/[:*/]/g, ' ');
        for (const token of resto.split(/\s+/)) {
            const reglaId = token.trim();
            if (reglaId) {
                reglas.add(reglaId);
            }
        }
    }

    return reglas;
}

export function tieneSentinelDisableFile(texto: string, reglaId: string): boolean {
    return reglasDeshabilitadasEnArchivo(texto.split('\n')).has(reglaId);
}
