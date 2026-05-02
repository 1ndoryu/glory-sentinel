/*
 * Motor de analisis estatico  Fachada.
 * Ejecuta reglas basadas en regex y delega verificaciones complejas
 * a static/staticCodeRules y static/staticCssRules.
 */

import * as vscode from 'vscode';
import {ReglaEstatica, Violacion} from '../types';
import {reglasEstaticas} from '../config/defaultRules';
import {reglaHabilitada, obtenerSeveridadRegla} from '../config/ruleRegistry';

/* Submodulos */
import {verificarLimiteLineas, verificarUseStateExcesivo, verificarImportsMuertos, verificarAnyType, verificarNonNullAssertion, verificarDirectorioAbarrotado} from './static/staticCodeRules';
import {verificarCardIconoExtiendeBase, verificarCssAdhocButtonStyle, verificarNomenclaturaCssIngles, verificarCssElementoHTMLDirecto} from './static/staticCssRules';

/* [124A-FP1] Deduplicacion de directorio-abarrotado: se reporta 1 vez por
 * directorio por ciclo de analisis, en vez de 1 vez por archivo.
 * limpiarDirectoriosReportados() debe llamarse al inicio de cada scan completo. */
const directoriosYaReportados = new Set<string>();
export function limpiarDirectoriosReportados(): void {
  directoriosYaReportados.clear();
}

/*
 * Ejecuta todas las reglas estaticas aplicables a un documento.
 * Retorna un array de violaciones detectadas.
 */
export function analizarEstatico(documento: vscode.TextDocument, reglasPersonalizadas?: ReglaEstatica[]): Violacion[] {
    const texto = documento.getText();
    const nombreArchivo = documento.fileName.split(/[/\\]/).pop() || '';
    const extension = '.' + nombreArchivo.split('.').pop();
    const violaciones: Violacion[] = [];

    /* Excluir prototipos de referencia */
    const nombreBase = nombreArchivo.replace(/\.[^.]+$/, '');
    if (nombreBase === 'ejemplo' || nombreBase === 'example') {
        return violaciones;
    }

    /* [054A-19] Excluir directorio examples/ (seeds, demos, no codigo de produccion) */
    const rutaNormExclude = documento.fileName.replace(/\\/g, '/');
    if (rutaNormExclude.includes('/examples/')) {
        return violaciones;
    }

    const reglas = reglasPersonalizadas || reglasEstaticas;

    /* Ejecutar reglas regex por linea o por archivo completo */
    for (const regla of reglas) {
        if (!reglaHabilitada(regla.id)) {
            continue;
        }
        if (!regla.aplicaA.some(ext => ext === extension || ext === 'todos')) {
            continue;
        }

        if (regla.id === 'css-adhoc-button-style') {
            continue;
        }

        /* [064A-1] Excluir archivos por nombre si la regla lo especifica */
        if (regla.excluirArchivos) {
            const nombreArchivo = documento.fileName.replace(/\\/g, '/').split('/').pop() || '';
            if (regla.excluirArchivos.some(ex => nombreArchivo === ex)) {
                continue;
            }
        }

        /* Excluir barras-decorativas en Glory/ */
        if (regla.id === 'barras-decorativas') {
            const rutaNorm = documento.fileName.replace(/\\/g, '/');
            if (rutaNorm.includes('/Glory/')) {
                continue;
            }
        }

        if (regla.porLinea) {
            violaciones.push(...ejecutarReglaPorLinea(texto, regla, documento));
        } else {
            violaciones.push(...ejecutarReglaCompleta(texto, regla, documento));
        }
    }

    /* Limites de lineas (excluir Glory/) */
    if (reglaHabilitada('limite-lineas')) {
        const rutaNormLimite = documento.fileName.replace(/\\/g, '/');
        if (!rutaNormLimite.includes('/Glory/')) {
            violaciones.push(...verificarLimiteLineas(documento, nombreArchivo));
        }
    }

    /* [114A-7] Densidad de directorio (todos los archivos de codigo).
     * [124A-FP1] Deduplicado: solo se reporta 1 vez por directorio por scan,
     * evitando N warnings identicos cuando un directorio tiene N archivos. */
    if (reglaHabilitada('directorio-abarrotado')) {
        const dirPadre = documento.fileName.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
        if (!directoriosYaReportados.has(dirPadre)) {
            const resultado = verificarDirectorioAbarrotado(documento);
            if (resultado.length > 0) {
                directoriosYaReportados.add(dirPadre);
            }
            violaciones.push(...resultado);
        }
    }

    /* useState excesivo (excluir hooks  son el destino de extraccion) */
    const esArchivoHook = /^use[A-Z]/.test(nombreArchivo);
    if ((extension === '.tsx' || extension === '.jsx') && !esArchivoHook && reglaHabilitada('usestate-excesivo')) {
        violaciones.push(...verificarUseStateExcesivo(texto, documento));
    }

    /* Imports muertos en JS/TS */
    if (['.ts', '.tsx', '.js', '.jsx'].includes(extension) && reglaHabilitada('import-muerto')) {
        violaciones.push(...verificarImportsMuertos(texto, documento));
    }

    /* any-type-explicito en TS/TSX */
    if (['.ts', '.tsx'].includes(extension) && !nombreArchivo.endsWith('.d.ts') && reglaHabilitada('any-type-explicito')) {
        violaciones.push(...verificarAnyType(texto, documento));
    }

    /* non-null assertions excesivas en TS/TSX */
    if (['.ts', '.tsx'].includes(extension) && !nombreArchivo.endsWith('.d.ts') && reglaHabilitada('non-null-assertion-excesivo')) {
        violaciones.push(...verificarNonNullAssertion(texto, documento));
    }

    /* Reglas CSS */
    if (['.css', '.scss'].includes(extension)) {
        const rutaNormCss = documento.fileName.replace(/\\/g, '/');
        if (reglaHabilitada('nomenclatura-css-ingles') && !rutaNormCss.includes('/Glory/')) {
            violaciones.push(...verificarNomenclaturaCssIngles(texto, documento, nombreArchivo));
        }
        if (reglaHabilitada('css-adhoc-button-style')) {
            violaciones.push(...verificarCssAdhocButtonStyle(texto, documento, nombreArchivo));
        }
        if (reglaHabilitada('card-icono-debe-extender-base')) {
            violaciones.push(...verificarCardIconoExtiendeBase(texto, documento, nombreArchivo));
        }
        if (reglaHabilitada('css-elemento-html-directo')) {
            violaciones.push(...verificarCssElementoHTMLDirecto(texto, documento, nombreArchivo));
        }
    }

    return violaciones;
}

export function tieneSentinelDisableFile(texto: string, reglaId: string): boolean {
    const lineas = texto.split('\n');

    for (const linea of lineas) {
        const indice = linea.indexOf('sentinel-disable-file');
        if (indice === -1) {
            continue;
        }

        const resto = linea
            .slice(indice + 'sentinel-disable-file'.length)
            .replace(/[:*/]/g, ' ');
        const reglasDeshabilitadas = resto
            .split(/\s+/)
            .map(token => token.trim())
            .filter(Boolean);

        if (reglasDeshabilitadas.includes(reglaId)) {
            return true;
        }
    }

    return false;
}

/* [104A-11] Permite style={{}} cuando solo se inyectan CSS custom properties,
 * incluso si el objeto completo vive en una sola linea. Evita falsos positivos
 * en barras de progreso y layouts que dependen de vars dinamicas. */
function styleInlineSoloCssVars(lineas: string[], indice: number): boolean {
    const ventana = lineas.slice(indice, Math.min(indice + 15, lineas.length)).join('\n');
    const match = /style\s*=\s*\{\s*\{([\s\S]*?)\}\s*(?:as\s+[A-Za-z0-9_.]+)?\s*\}/.exec(ventana);
    if (!match) {
        return false;
    }

    const propiedades = match[1]
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split(',')
        .map(token => token.trim())
        .filter(Boolean);

    if (propiedades.length === 0) {
        return false;
    }

    return propiedades.every(propiedad => /^['"]--[\w-]+['"]\s*:/.test(propiedad));
}

/*
 * Ejecuta una regla regex linea por linea.
 */
function ejecutarReglaPorLinea(texto: string, regla: ReglaEstatica, documento: vscode.TextDocument): Violacion[] {
    const violaciones: Violacion[] = [];

    if (tieneSentinelDisableFile(texto, regla.id)) {
        return violaciones;
    }

    const lineas = texto.split('\n');

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];

        if (i > 0 && lineas[i - 1].includes(`sentinel-disable-next-line ${regla.id}`)) {
            continue;
        }
        if (linea.includes(`sentinel-disable ${regla.id}`)) {
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
            const patronLocal = new RegExp(regla.patron.source, regla.patron.flags.replace('g', ''));
            if (!patronLocal.test(sinContexto)) {
                continue;
            }
        }

        const patron = new RegExp(regla.patron.source, regla.patron.flags.replace('g', ''));
        const match = patron.exec(linea);

        if (match) {
            /* [054A-19] inline-style-prohibido: permitir style={{}} cuando solo establece
             * CSS custom properties (--var). Es el patrón correcto para inyectar
             * valores dinámicos de JS a CSS sin usar inline styles reales. */
            if (regla.id === 'inline-style-prohibido') {
                if (styleInlineSoloCssVars(lineas, i)) continue;
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

/*
 * Ejecuta una regla regex contra el archivo completo.
 * Util para patrones multilinea como catch vacio.
 */
function ejecutarReglaCompleta(texto: string, regla: ReglaEstatica, documento: vscode.TextDocument): Violacion[] {
    const violaciones: Violacion[] = [];

    if (tieneSentinelDisableFile(texto, regla.id)) {
        return violaciones;
    }

    const patron = new RegExp(regla.patron.source, regla.patron.flags + (regla.patron.flags.includes('g') ? '' : 'g'));

    let match: RegExpExecArray | null;
    while ((match = patron.exec(texto)) !== null) {
        const posicion = documento.positionAt(match.index);
        const posicionFin = documento.positionAt(match.index + match[0].length);

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
