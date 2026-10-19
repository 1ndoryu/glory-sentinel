/* Analizador estático (ejecución de reglas por línea y exclusión de tests.) Extraído de staticAnalyzer.ts. */
import { ReglaEstatica, Violacion } from '../../../types';
import { CoreTextDocument } from '../../../core/runtime-proyecto/types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { calcularRangosTest, esArchivoSoloTest, esRutaDeTestRust } from '../../rust/rustTestScope';
import { styleInlineSoloCssVars, rangosComentados, enComentario } from './staticLineas';
import { enmascararLiterales } from '../../../utils/analisis/literalesCodigo';

/* [08AA-26] Reglas sqlx que no aplican al SQL de fixtures dentro de #[cfg(test)]:
 * el sqlx::query runtime es el habitual en tests y la verificacion compile-time
 * solo importa en produccion. Mismo criterio que handler-accede-bd-rs. */
const REGLAS_SQL_SOLO_PRODUCCION = new Set(['sqlx-query-sin-macro', 'sqlx-query-as-sin-macro']);

/* [por que] Un TODO dentro de una cadena (fixture de test, texto de ejemplo) no es un
 * marcador pendiente: estas reglas solo miran el código y los comentarios. */
const REGLAS_SOLO_CODIGO = new Set(['todo-pendiente']);

/* Archivo de test por nombre (.test./.spec.) o por carpeta (test/, __tests__/).
 * Normaliza los separadores para cubrir rutas Windows y POSIX. */
function esArchivoDeTest(rutaArchivo: string): boolean {
    const ruta = rutaArchivo.replace(/\\/g, '/');
    return ['.test.', '.spec.', '/test/', '/__tests__/'].some(patron => ruta.includes(patron));
}

/*
 * Ejecuta una regla regex linea por linea.
 */
export function ejecutarReglaPorLinea(
    lineas: string[],
    regla: ReglaEstatica,
    documento: CoreTextDocument,
    deshabilitadasEnArchivo: Set<string>,
): Violacion[] {
    const violaciones: Violacion[] = [];

    if (deshabilitadasEnArchivo.has(regla.id)) {
        return violaciones;
    }

    /* [039A-1 FP-S2] Solo la regla de estilo inline salta comentarios: es la que
     * se reviso y midio. Generalizarlo al resto de reglas es un cambio de
     * comportamiento que necesita su propio caso y su propia medicion. */
    const comentarios = regla.id === 'inline-style-prohibido' ? rangosComentados(lineas) : null;
    /* [08AA-26] Archivo entero de solo-test (#![cfg(test)], tests/ del crate o
     * <mod>/tests.rs): no hay produccion que vigilar. */
    if (REGLAS_SQL_SOLO_PRODUCCION.has(regla.id) && documento.fileName.endsWith('.rs')
        && (esArchivoSoloTest(lineas.join('\n')) || esRutaDeTestRust(documento.fileName))) {
        return violaciones;
    }
    const enTest = REGLAS_SQL_SOLO_PRODUCCION.has(regla.id) && documento.fileName.endsWith('.rs')
        ? calcularRangosTest(lineas)
        : null;

    /* emoji-en-codigo no aplica a tests: los emoji ahi son datos de prueba, no UI. */
    if (regla.id === 'emoji-en-codigo' && esArchivoDeTest(documento.fileName)) {
        return violaciones;
    }

    /* Se compilan una vez por regla, no por linea. Sin 'g' el RegExp no guarda
     * estado entre llamadas, asi que reutilizarlo equivale a crearlo en cada linea. */
    const patron = new RegExp(regla.patron.source, regla.patron.flags.replace('g', ''));
    const marcaSiguienteLinea = `sentinel-disable-next-line ${regla.id}`;
    const marcaLinea = `sentinel-disable ${regla.id}`;

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];

        if (i > 0 && lineas[i - 1].includes(marcaSiguienteLinea)) {
            continue;
        }
        if (linea.includes(marcaLinea)) {
            continue;
        }
        if (enTest?.has(i)) {
            continue;
        }

        /* Saltar doc comments PHP para at-generico-php */
        if (regla.id === 'at-generico-php') {
            const lineaTrimmed = linea.trim();
            if (lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/**') || lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('#')) {
                continue;
            }
        }

        /* [044A-14] emoji-en-codigo: no flaggear emojis dentro de string literals ni comentarios.
         * Solo flaggear emojis en codigo renderizable (JSX text content, atributos, etc). */
        if (regla.id === 'emoji-en-codigo') {
            const lineaTrimmed = linea.trim();
            /* Saltar lineas de comentario de bloque o de linea */
            if (lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/*') || lineaTrimmed.startsWith('//')) {
                continue;
            }
            /* Quitar contenido de string literals (comillas simples, dobles, backticks) */
            const sinStrings = linea.replace(/(['"`])(?:(?!\1|\\).|\\.)*\1/g, '');
            /* Quitar comentarios inline restantes */
            const sinContexto = sinStrings.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/g, '');
            if (!patron.test(sinContexto)) {
                continue;
            }
        }

        const match = patron.exec(REGLAS_SOLO_CODIGO.has(regla.id) ? enmascararLiterales(linea) : linea);

        if (match) {
            /* [054A-19] inline-style-prohibido: permitir style={{}} cuando solo establece
             * CSS custom properties (--var). Es el patrón correcto para inyectar
             * valores dinámicos de JS a CSS sin usar inline styles reales. */
            if (regla.id === 'inline-style-prohibido') {
                if (comentarios && enComentario(comentarios[i], match.index)) continue;
                if (styleInlineSoloCssVars(lineas, i)) continue;
            }

            /* hardcoded-secret: un valor en MAYUSCULAS_CON_GUIONES_BAJOS (p. ej. 'SECRET_QUERY')
             * es una constante canario de prueba, no un secreto real. */
            if (regla.id === 'hardcoded-secret') {
                // Solo valores entre comillas: sin ellas no hay canario que reconocer
                const valor = match[0].match(/['"]([^'"]*)['"]/)?.[1];
                if (valor !== undefined && /^[A-Z_]+$/.test(valor)) continue;
            }

            let mensaje = regla.mensaje;
            if (match[1]) {
                mensaje = mensaje.replace('$1', match[1]);
            }

            violaciones.push({
                reglaId: regla.id,
                mensaje,
                severidad: obtenerSeveridadRegla(regla.id),
                linea: i,
                columna: match.index,
                columnaFin: match.index + match[0].length,
                quickFixId: regla.quickFixId,
                fuente: 'estatico'
            });
        }
    }

    return violaciones;
}
