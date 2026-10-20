/* Analizador estático (orquestador del análisis estático: recorre reglas y deduplica avisos de directorio.) Extraído de staticAnalyzer.ts. */
import { ReglaEstatica, Violacion } from '../../../types';
import { CoreTextDocument } from '../../../core/runtime-proyecto/types';
import { reglasEstaticas } from '../../../config/defaultRules';
import { reglaHabilitada } from '../../../config/ruleRegistry';
import { esRutaGlory, proyectoTieneModalCanonico } from '../../../utils/analisisHelpers';
import { obtenerWorkspaceRoots } from '../../../core/seguridad-rutas/workspaceRoots';
import { extensionCanonica } from '../../../core/runtime-proyecto/language';
import { REGLAS_LIMITE_LINEAS, verificarLimiteLineas, verificarUseStateExcesivo, verificarImportsMuertos, verificarAnyType, verificarNonNullAssertion, verificarDirectorioAbarrotado, verificarHtmlSinOrigenDeclarado, verificarTodoProsaSinMarcador } from '../staticCodeRules';
import { verificarCardIconoExtiendeBase, verificarCssAdhocButtonStyle, verificarCssEspecificacionDisenoLocal, verificarModalSemanticaNoCanonica, verificarNomenclaturaCssIngles, verificarCssElementoHTMLDirecto, verificarCssHardcoded } from '../staticCssRules';
import { PortableBoundaryConfig, verificarReglasPortables } from '../portableRules';
import { reglasDeshabilitadasEnArchivo } from './staticSentinelDisable';
import { AjustesProyecto, AJUSTES_PROYECTO_DEFECTO } from '../../ajustesProyecto';
import { ejecutarReglaPorLinea } from './staticReglasPorLinea';
import { ejecutarReglaCompleta } from './staticReglaCompleta';

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
export interface StaticAnalysisOptions {
    directoryExceptions?: string[];
    portableBoundaries?: PortableBoundaryConfig;
    /* [149A-1] Sufijos de ruta de productores HTML declarados por el proyecto
     * (patron directoryExceptions). Default vacio: cada consumidor declara. */
    htmlProductoresPermitidos?: string[];
    /* Marcadores Glory y exenciones del proyecto; sin valor usa los de por defecto. */
    ajustes?: AjustesProyecto;
}

export function analizarEstatico(
    documento: CoreTextDocument,
    reglasPersonalizadas?: ReglaEstatica[],
    opciones: StaticAnalysisOptions = {},
): Violacion[] {
    const texto = documento.getText();
    const nombreArchivo = documento.fileName.split(/[/\\]/).pop() || '';
    /* [17AA-2] Extension canonica: `.mjs`/`.cjs` cuentan como `.js` y `.mts`/`.cts` como
     * `.ts`, para que casen con las listas de `aplicaA` y con los chequeos por extension
     * de mas abajo sin tener que añadirlos uno a uno. */
    const extension = extensionCanonica('.' + nombreArchivo.split('.').pop());
    const violaciones: Violacion[] = [];
    const ajustes = opciones.ajustes ?? AJUSTES_PROYECTO_DEFECTO;

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

    /* Una sola particion del texto y una sola busqueda de `sentinel-disable-file`
     * por documento: antes se repetian por cada regla. */
    const lineas = texto.split('\n');
    const deshabilitadasEnArchivo = reglasDeshabilitadasEnArchivo(lineas);

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
            if (esRutaGlory(rutaNorm, ajustes.marcadoresGlory)) {
                continue;
            }
        }

        if (regla.porLinea) {
            violaciones.push(...ejecutarReglaPorLinea(lineas, regla, documento, deshabilitadasEnArchivo));
        } else {
            violaciones.push(...ejecutarReglaCompleta(texto, regla, documento, deshabilitadasEnArchivo));
        }
    }

    /* Limites de lineas (excluir Glory/) */
    if (REGLAS_LIMITE_LINEAS.some(reglaId => reglaHabilitada(reglaId))) {
        const rutaNormLimite = documento.fileName.replace(/\\/g, '/');
        if (!esRutaGlory(rutaNormLimite, ajustes.marcadoresGlory)) {
            violaciones.push(...verificarLimiteLineas(documento, nombreArchivo));
        }
    }

    /* [114A-7] Densidad de directorio (todos los archivos de codigo).
     * [124A-FP1] Deduplicado: solo se reporta 1 vez por directorio por scan,
     * evitando N warnings identicos cuando un directorio tiene N archivos. */
    if (reglaHabilitada('directorio-abarrotado')) {
        const dirPadre = documento.fileName.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
        if (!directoriosYaReportados.has(dirPadre)) {
            const resultado = verificarDirectorioAbarrotado(documento, opciones.directoryExceptions ?? []);
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

    /* [149A-1] Productor HTML sin declarar (TS/TSX, no .d.ts).
     * Region 119A-4: este bloque es nuevo y no toca imports (L8-12) ni el
     * hunk S4 (~L156+); solo anade import nominal + bloque aqui. */
    if (['.ts', '.tsx'].includes(extension) && !nombreArchivo.endsWith('.d.ts') && reglaHabilitada('html-sin-origen-declarado')) {
        violaciones.push(...verificarHtmlSinOrigenDeclarado(texto, documento, opciones.htmlProductoresPermitidos ?? []));
    }

    /* [289A-1] Mencion 'todo' sin marcador (mismo scope que todo-pendiente).
     * Migrada desde VarSense: higiene de codigo, dueno Sentinel. */
    if (['.php', '.ts', '.tsx', '.js', '.jsx', '.css', '.rs'].includes(extension) && reglaHabilitada('todo-prosa-sin-marcador')) {
        violaciones.push(...verificarTodoProsaSinMarcador(texto, documento));
    }

    /* [018A-5] Reglas agnósticas de boundaries/lifecycle. La configuración
     * aporta los paths del consumidor; el core no conoce rutas del proyecto. */
    violaciones.push(...verificarReglasPortables(documento, opciones.portableBoundaries));

    /* Reglas CSS */
    if (['.css', '.scss'].includes(extension)) {
        const rutaNormCss = documento.fileName.replace(/\\/g, '/');
        if (reglaHabilitada('nomenclatura-css-ingles') && !esRutaGlory(rutaNormCss, ajustes.marcadoresGlory)) {
            violaciones.push(...verificarNomenclaturaCssIngles(texto, documento, nombreArchivo));
        }
        if (reglaHabilitada('css-adhoc-button-style')) {
            /* [15A-25] Coste con cache; solo se calcula si la regla esta habilitada. */
            violaciones.push(...verificarCssAdhocButtonStyle(texto, documento, nombreArchivo, obtenerWorkspaceRoots(), ajustes));
        }
        if (reglaHabilitada('css-especificacion-diseno-local')) {
            violaciones.push(...verificarCssEspecificacionDisenoLocal(texto, documento, nombreArchivo, obtenerWorkspaceRoots(), ajustes));
        }
        if (reglaHabilitada('card-icono-debe-extender-base')) {
            violaciones.push(...verificarCardIconoExtiendeBase(texto, documento, nombreArchivo));
        }
        if (reglaHabilitada('modal-semantica-no-canonica')) {
            /* [119A-4 S4] Coste con cache; solo se calcula si la regla esta habilitada. */
            const tieneModalCanonico = proyectoTieneModalCanonico(obtenerWorkspaceRoots());
            violaciones.push(...verificarModalSemanticaNoCanonica(texto, documento, nombreArchivo, tieneModalCanonico, ajustes));
        }
        if (reglaHabilitada('css-elemento-html-directo')) {
            violaciones.push(...verificarCssElementoHTMLDirecto(texto, documento, nombreArchivo, ajustes));
        }
        /* [318A-4] Regla reactivada: colores hardcodeados fuera de tokens. */
        if (reglaHabilitada('css-hardcoded-value')) {
            violaciones.push(...verificarCssHardcoded(texto, documento, nombreArchivo));
        }
    }

    return violaciones;
}
