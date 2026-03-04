/*
 * Reglas para detectar claves incorrectas en DefaultContentManager::define().
 * En lugar de 6 funciones copy-paste (meta, slug, titulo, imagen, galeria, contenido),
 * usa UNA funcion generica parametrizada con un array de configuraciones.
 *
 * Cada config define: la clave incorrecta, la clave correcta, el patron regex,
 * y el reglaId para el registro.
 */

import {Violacion} from '../../types';
import {obtenerSeveridadRegla} from '../../config/ruleRegistry';
import {esComentario, tieneSentinelDisable} from '../../utils/analisisHelpers';

/* Configuracion de una regla de clave incorrecta en DefaultContent */
interface ConfigClaveIncorrecta {
    reglaId: string;
    claveIncorrecta: string;
    claveCorrecta: string;
    /* Regex que matchea la clave incorrecta como key de array PHP.
     * El patron excluye variantes que empiecen con el mismo prefijo
     * pero sean claves diferentes (ej: 'meta' no matchea 'metaEntrada'). */
    patron: RegExp;
    descripcionError: string;
}

/* Todas las configuraciones de claves incorrectas conocidas */
const CONFIGURACIONES: ConfigClaveIncorrecta[] = [
    {
        reglaId: 'glory-meta-clave-incorrecta',
        claveIncorrecta: 'meta',
        claveCorrecta: 'metaEntrada',
        patron: /['"]meta['"]\s*=>/,
        descripcionError: "PostSyncHandler usa 'metaEntrada' para escribir via meta_input. Con 'meta' el post se crea sin ningun metadato (bug silencioso de perdida de datos)."
    },
    {
        reglaId: 'glory-slug-clave-incorrecta',
        claveIncorrecta: 'slug',
        claveCorrecta: 'slugDefault',
        patron: /['"]slug['"]\s*=>/,
        descripcionError: "PostSyncHandler usa 'slugDefault' para definir el slug del post. Con 'slug' se ignora por completo y WordPress genera un slug automatico."
    },
    {
        reglaId: 'glory-titulo-clave-incorrecta',
        claveIncorrecta: 'title',
        claveCorrecta: 'titulo',
        patron: /['"]title['"]\s*=>/,
        descripcionError: "DefaultContentManager usa 'titulo' para wp_insert_post['post_title']. Con 'title' (ingles) se ignora y el post se crea sin titulo."
    },
    {
        reglaId: 'glory-imagen-clave-incorrecta',
        claveIncorrecta: 'imagen',
        claveCorrecta: 'imagenDestacadaAsset',
        patron: /['"](imagen|featured_image|thumbnail)['"]\s*=>/,
        descripcionError: "PostSyncHandler usa 'imagenDestacadaAsset' para la imagen destacada. Otras variantes como 'imagen', 'featured_image' o 'thumbnail' se ignoran."
    },
    {
        reglaId: 'glory-galeria-clave-incorrecta',
        claveIncorrecta: 'galeria',
        claveCorrecta: 'galeriaAssets',
        patron: /['"](galeria|gallery)['"]\s*=>/,
        descripcionError: "PostSyncHandler usa 'galeriaAssets' para la galeria de imagenes. Con 'galeria' o 'gallery' se ignora y no se importan imagenes."
    },
    {
        reglaId: 'glory-contenido-clave-incorrecta',
        claveIncorrecta: 'content',
        claveCorrecta: 'contenido',
        patron: /['"]content['"]\s*=>/,
        descripcionError: "DefaultContentManager usa 'contenido' para wp_insert_post['post_content']. Con 'content' (ingles) se ignora y el post se crea sin contenido."
    }
];

/* Helper: retorna false si el archivo no usa DefaultContentManager::define */
function archivoUsaDefaultContentDefine(lineas: string[]): boolean {
    return /DefaultContentManager\s*::\s*define\s*\(/.test(lineas.join('\n'));
}

/*
 * Verifica una clave incorrecta especifica en un archivo de DefaultContent.
 */
function verificarClave(lineas: string[], config: ConfigClaveIncorrecta): Violacion[] {
    const violaciones: Violacion[] = [];

    for (let i = 0; i < lineas.length; i++) {
        if (esComentario(lineas[i])) {
            continue;
        }
        if (tieneSentinelDisable(lineas, i, config.reglaId)) {
            continue;
        }

        /* Excluir variantes que empiecen con el mismo prefijo pero sean claves correctas.
         * Ej: para 'meta', excluir 'metaEntrada', 'metaBox', 'metaDesc'. */
        const linea = lineas[i];
        if (config.patron.test(linea)) {
            /* Para 'meta', verificar que no sea 'metaEntrada' u otra variante valida */
            if (config.claveIncorrecta === 'meta' && /['"]meta[A-Za-z]/.test(linea)) {
                continue;
            }
            /* Para 'slug', verificar que no sea 'slugDefault' */
            if (config.claveIncorrecta === 'slug' && /['"]slug[A-Za-z]/.test(linea)) {
                continue;
            }

            violaciones.push({
                reglaId: config.reglaId,
                mensaje: `Clave '${config.claveIncorrecta}' incorrecta en DefaultContentManager::define(). ${config.descripcionError}`,
                severidad: obtenerSeveridadRegla(config.reglaId),
                linea: i,
                sugerencia: `Renombrar la clave '${config.claveIncorrecta}' a '${config.claveCorrecta}' en la definicion del contenido.`,
                fuente: 'estatico'
            });
        }
    }

    return violaciones;
}

/*
 * Ejecuta todas las verificaciones de claves incorrectas en DefaultContent.
 * Recibe la lista de reglaIds habilitadas para solo ejecutar las necesarias.
 */
export function verificarDefaultContentClaves(lineas: string[], reglasHabilitadas: Set<string>): Violacion[] {
    /* Optimizacion: si el archivo no define contenido, salir temprano */
    if (!archivoUsaDefaultContentDefine(lineas)) {
        return [];
    }

    const violaciones: Violacion[] = [];

    for (const config of CONFIGURACIONES) {
        if (reglasHabilitadas.has(config.reglaId)) {
            violaciones.push(...verificarClave(lineas, config));
        }
    }

    return violaciones;
}

/* Exportar las configuraciones para que otros modulos puedan consultar los reglaIds */
export const REGLA_IDS_DEFAULT_CONTENT = CONFIGURACIONES.map(c => c.reglaId);
