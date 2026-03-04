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
import {verificarLimiteLineas, verificarUseStateExcesivo, verificarImportsMuertos, verificarAnyType, verificarNonNullAssertion} from './static/staticCodeRules';
import {verificarNomenclaturaCssIngles} from './static/staticCssRules';

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

    const reglas = reglasPersonalizadas || reglasEstaticas;

    /* Ejecutar reglas regex por linea o por archivo completo */
    for (const regla of reglas) {
        if (!reglaHabilitada(regla.id)) {
            continue;
        }
        if (!regla.aplicaA.some(ext => ext === extension || ext === 'todos')) {
            continue;
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
    }

    return violaciones;
}

/*
 * Ejecuta una regla regex linea por linea.
 */
function ejecutarReglaPorLinea(texto: string, regla: ReglaEstatica, documento: vscode.TextDocument): Violacion[] {
    const violaciones: Violacion[] = [];
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

        const patron = new RegExp(regla.patron.source, regla.patron.flags.replace('g', ''));
        const match = patron.exec(linea);

        if (match) {
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
