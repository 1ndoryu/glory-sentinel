/* Analizador estático (utilidades de línea: comentarios, comas de nivel superior y style inline con CSS custom properties.) Extraído de staticAnalyzer.ts. */

/* [104A-11] Permite style={{}} cuando solo se inyectan CSS custom properties,
 * incluso si el objeto completo vive en una sola linea. Evita falsos positivos
 * en barras de progreso y layouts que dependen de vars dinamicas.
 * [039A-1 FP-S1] Cubre tambien la clave computada (`['--x' as string]: valor`),
 * que es la forma canonica de inyectar una custom property en TypeScript:
 * `CSSProperties` no admite claves `--*`, asi que el indice computado no es un
 * estilo inline real. Medido en EditorPixelArt.tsx. */
function propiedadEsCssVar(token: string): boolean {
    return /^(?:\[\s*)?['"]--[\w-]+['"](?:\s+as\s+[A-Za-z0-9_$.]+(?:<[^>]*>)?)?\s*\]?\s*:/.test(token);
}

/* [15A-25] Divide por las comas de nivel superior: las que no estan dentro de
 * llaves, parentesis, corchetes ni literales. Un `split(',')` a secas partia
 * `'--porcentaje': `${Math.min(100, proceso.progreso)}%`` por la coma del
 * `Math.min` y el trozo resultante dejaba de parecer una custom property, de
 * modo que la exencion se perdia y salia un `inline-style-prohibido` falso.
 * Medido en KAMPLES: 7 casos, todos con una coma dentro de una interpolacion. */
function dividirComasNivelSuperior(texto: string): string[] {
    const partes: string[] = [];
    let profundidad = 0;
    let comilla: string | null = null;
    let inicio = 0;

    for (let i = 0; i < texto.length; i += 1) {
        const caracter = texto[i];
        if (comilla) {
            if (caracter === '\\') { i += 1; continue; }
            if (caracter === comilla) { comilla = null; }
            continue;
        }
        if (caracter === '"' || caracter === "'" || caracter === '`') { comilla = caracter; continue; }
        if (caracter === '(' || caracter === '{' || caracter === '[') { profundidad += 1; continue; }
        if (caracter === ')' || caracter === '}' || caracter === ']') { profundidad -= 1; continue; }
        if (caracter === ',' && profundidad === 0) {
            partes.push(texto.slice(inicio, i));
            inicio = i + 1;
        }
    }
    partes.push(texto.slice(inicio));

    return partes.map(parte => parte.trim()).filter(Boolean);
}

export function styleInlineSoloCssVars(lineas: string[], indice: number): boolean {
    const ventana = lineas.slice(indice, Math.min(indice + 15, lineas.length)).join('\n');
    const match = /style\s*=\s*\{\s*\{([\s\S]*?)\}\s*(?:as\s+[A-Za-z0-9_.]+)?\s*\}/.exec(ventana);
    if (!match) {
        return false;
    }

    const propiedades = dividirComasNivelSuperior(match[1].replace(/\/\*[\s\S]*?\*\//g, ' '));

    if (propiedades.length === 0) {
        return false;
    }

    return propiedades.every(propiedadEsCssVar);
}

/* [039A-1 FP-S2] Rangos comentados por linea, en una sola pasada por archivo.
 * La regla es un regex por linea: sin esto, un `style={{}}` escrito dentro de un
 * comentario JSX o de bloque cuenta como estilo inline real.
 * Es una correccion PREVENTIVA: la medicion del area no encontro ningun caso
 * vivo (el repro del backlog mezclaba un comentario con un estilo real).
 * Se rastrean comillas para no confundir el `//` de una URL con un comentario. */
export function rangosComentados(lineas: string[]): Array<Array<[number, number]>> {
    const porLinea: Array<Array<[number, number]>> = [];
    let enBloque = false;

    for (const linea of lineas) {
        const rangos: Array<[number, number]> = [];
        let cursor = 0;
        let comilla: string | null = null;

        while (cursor < linea.length) {
            if (enBloque) {
                const cierre = linea.indexOf('*/', cursor);
                if (cierre === -1) {
                    rangos.push([cursor, linea.length]);
                    cursor = linea.length;
                } else {
                    rangos.push([cursor, cierre + 2]);
                    cursor = cierre + 2;
                    enBloque = false;
                }
                continue;
            }

            const caracter = linea[cursor];
            if (comilla) {
                if (caracter === '\\') {
                    cursor += 2;
                    continue;
                }
                if (caracter === comilla) {
                    comilla = null;
                }
                cursor += 1;
                continue;
            }
            if (caracter === '"' || caracter === "'" || caracter === '`') {
                comilla = caracter;
                cursor += 1;
                continue;
            }
            if (caracter === '/' && linea[cursor + 1] === '*') {
                enBloque = true;
                rangos.push([cursor, cursor + 2]);
                cursor += 2;
                continue;
            }
            if (caracter === '/' && linea[cursor + 1] === '/') {
                rangos.push([cursor, linea.length]);
                cursor = linea.length;
                continue;
            }
            cursor += 1;
        }

        porLinea.push(rangos);
    }

    return porLinea;
}

export function enComentario(rangos: Array<[number, number]>, columna: number): boolean {
    return rangos.some(([inicio, fin]) => columna >= inicio && columna < fin);
}
