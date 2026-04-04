/*
 * Registro centralizado de todas las reglas de Code Sentinel.
 * Cada regla tiene id, nombre, severidad por defecto y categoria.
 * La configuracion del usuario puede deshabilitar reglas o cambiar severidad
 * via la propiedad codeSentinel.rules en settings.json.
 *
 * Este modulo es la UNICA FUENTE DE VERDAD para el estado activo de las reglas.
 * Todos los analyzers deben consultar reglaHabilitada() y obtenerSeveridadRegla()
 * antes de reportar violaciones.
 */

import * as vscode from 'vscode';
import { SeveridadRegla, CategoriaRegla } from '../types';

/* Definicion inmutable de una regla en el sistema */
export interface DefinicionRegla {
  id: string;
  nombre: string;
  severidadDefault: SeveridadRegla;
  categoria: CategoriaRegla;
  /* Si es false, la regla viene desactivada out-of-the-box sin config del usuario */
  habilitadaDefault?: boolean;
}

/* Formato que el usuario escribe en settings.json */
interface ConfigReglaUsuario {
  habilitada?: boolean;
  severidad?: SeveridadRegla;
}

/* Configuracion efectiva (default + override del usuario) */
interface ConfigReglaEfectiva {
  habilitada: boolean;
  severidad: SeveridadRegla;
}

/*
 * Registro completo de TODAS las reglas del sistema con sus defaults.
 * Organizado por origen (archivo fuente del analyzer).
 */
const REGISTRO: DefinicionRegla[] = [

  /* --- Regex (defaultRules.ts) --- */
  { id: 'php-supresor-at', nombre: 'Supresor @ en PHP', severidadDefault: 'error', categoria: CategoriaRegla.PatronesProhibidos },
  { id: 'eval-prohibido', nombre: 'eval() prohibido', severidadDefault: 'error', categoria: CategoriaRegla.PatronesProhibidos },
  { id: 'innerhtml-variable', nombre: 'innerHTML con variable', severidadDefault: 'warning', categoria: CategoriaRegla.PatronesProhibidos },
  /* css-inline-jsx eliminada: VarSense ya maneja deteccion de CSS inline en React */
  { id: 'git-add-all', nombre: 'git add . / --all', severidadDefault: 'warning', categoria: CategoriaRegla.PatronesProhibidos },
  { id: 'catch-vacio', nombre: 'Catch vacio', severidadDefault: 'error', categoria: CategoriaRegla.PatronesProhibidos },
  { id: 'hardcoded-secret', nombre: 'Secret hardcodeado', severidadDefault: 'error', categoria: CategoriaRegla.PatronesProhibidos },
  { id: 'barras-decorativas', nombre: 'Barras decorativas', severidadDefault: 'information', categoria: CategoriaRegla.EstructuraNomenclatura },
  { id: 'at-generico-php', nombre: 'Supresor @ generico PHP', severidadDefault: 'warning', categoria: CategoriaRegla.PatronesProhibidos },

  /* --- Computed (staticAnalyzer.ts) --- */
  { id: 'limite-lineas', nombre: 'Limite de lineas', severidadDefault: 'warning', categoria: CategoriaRegla.LimitesArchivo },
  { id: 'usestate-excesivo', nombre: 'useState excesivo', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'import-muerto', nombre: 'Import sin uso', severidadDefault: 'warning', categoria: CategoriaRegla.EstructuraNomenclatura },

  /* --- PHP (phpAnalyzer.ts) --- */
  { id: 'controller-sin-trycatch', nombre: 'Controller sin try-catch', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },
  { id: 'wpdb-sin-prepare', nombre: '$wpdb sin prepare()', severidadDefault: 'error', categoria: CategoriaRegla.SeguridadSql },
  { id: 'request-json-directo', nombre: 'JSON params sin filtrar', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },
  { id: 'json-decode-inseguro', nombre: 'json_decode sin verificacion', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },
  { id: 'exec-sin-escapeshellarg', nombre: 'exec sin escapeshellarg', severidadDefault: 'error', categoria: CategoriaRegla.PatronesProhibidos },
  { id: 'curl-sin-verificacion', nombre: 'curl_exec sin curl_error', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },
  { id: 'temp-sin-finally', nombre: 'tempnam sin finally', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },

  /* --- React (reactAnalyzer.ts) --- */
  { id: 'useeffect-sin-cleanup', nombre: 'useEffect sin cleanup', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'mutacion-directa-estado', nombre: 'Mutacion directa estado', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'zustand-sin-selector', nombre: 'Zustand sin selector', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'console-generico-en-catch', nombre: 'console.log en catch', severidadDefault: 'warning', categoria: CategoriaRegla.PatronesProhibidos },
  { id: 'error-enmascarado', nombre: 'Error enmascarado como exito', severidadDefault: 'error', categoria: CategoriaRegla.ReactPatrones },

  /* --- PHP adicional (phpAnalyzer.ts) --- */
  { id: 'sanitizacion-faltante', nombre: 'Request sin sanitizar', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },

  /* --- Sprint 8: Nuevas reglas PHP --- */
  { id: 'lock-sin-finally', nombre: 'Lock sin finally', severidadDefault: 'error', categoria: CategoriaRegla.WordPressPhp },
  { id: 'catch-critico-solo-log', nombre: 'Catch critico solo log', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },
  { id: 'toctou-select-insert', nombre: 'TOCTOU select-insert', severidadDefault: 'error', categoria: CategoriaRegla.SeguridadSql },
  { id: 'cadena-isset-update', nombre: 'Cadena isset-update', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },
  { id: 'query-doble-verificacion', nombre: 'Query doble verificacion', severidadDefault: 'information', categoria: CategoriaRegla.SeguridadSql },
  { id: 'json-sin-limite-bd', nombre: 'JSON sin limite a BD', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },
  { id: 'retorno-ignorado-repo', nombre: 'Retorno repo ignorado', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },
  { id: 'mime-type-cliente', nombre: 'MIME type del cliente', severidadDefault: 'error', categoria: CategoriaRegla.PatronesProhibidos },

  /* --- Glory Schema (gloryAnalyzer.ts) — Sprint 1 --- */
  { id: 'hardcoded-sql-column', nombre: 'Columna SQL hardcodeada', severidadDefault: 'warning', categoria: CategoriaRegla.GlorySchema },
  { id: 'hardcoded-enum-value', nombre: 'Valor enum hardcodeado', severidadDefault: 'warning', categoria: CategoriaRegla.GlorySchema },
  { id: 'endpoint-accede-bd', nombre: 'Controller accede a BD', severidadDefault: 'warning', categoria: CategoriaRegla.GlorySchema },
  { id: 'interval-sin-whitelist', nombre: 'INTERVAL sin whitelist', severidadDefault: 'error', categoria: CategoriaRegla.GlorySchema },
  { id: 'open-redirect', nombre: 'Redireccion insegura', severidadDefault: 'error', categoria: CategoriaRegla.GlorySchema },
  { id: 'return-void-critico', nombre: 'Escritura retorna void', severidadDefault: 'warning', categoria: CategoriaRegla.GlorySchema },

  /* --- Sprint 2: React (reactAnalyzer.ts) --- */
  { id: 'zustand-objeto-selector', nombre: 'Zustand selector crea ref nueva', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'key-index-lista', nombre: 'key={index} en lista', severidadDefault: 'hint', categoria: CategoriaRegla.ReactPatrones },
  { id: 'componente-sin-hook-glory', nombre: 'Componente sin hook dedicado', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'promise-sin-catch', nombre: 'Promise sin catch', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'useeffect-dep-inestable', nombre: 'useEffect dep inestable', severidadDefault: 'hint', categoria: CategoriaRegla.ReactPatrones },

  /* --- Sprint 2: TypeScript (staticAnalyzer.ts) --- */
  { id: 'any-type-explicito', nombre: 'Tipo any explicito', severidadDefault: 'hint', categoria: CategoriaRegla.EstructuraNomenclatura },

  /* --- Sprint 2: Glory (gloryAnalyzer.ts) --- */
  { id: 'isla-no-registrada', nombre: 'Isla no registrada', severidadDefault: 'warning', categoria: CategoriaRegla.GlorySchema },

  /* --- Sprint 3: PHP (gloryAnalyzer.ts) --- */
  { id: 'n-plus-1-query', nombre: 'Query N+1 en loop', severidadDefault: 'warning', categoria: CategoriaRegla.SeguridadSql },
  { id: 'controller-fqn-inline', nombre: 'FQN inline en PHP', severidadDefault: 'hint', categoria: CategoriaRegla.EstructuraNomenclatura },
  { id: 'php-sin-return-type', nombre: 'PHP sin return type', severidadDefault: 'hint', categoria: CategoriaRegla.WordPressPhp },
  { id: 'repository-sin-whitelist-columnas', nombre: 'SELECT * sin columnas', severidadDefault: 'hint', categoria: CategoriaRegla.SeguridadSql },

  /* --- Sprint 6: DefaultContent (gloryAnalyzer.ts) ---
   * Claves incorrectas en definiciones de DefaultContentManager::define().
   * PostSyncHandler lee el array $definition con claves exactas en español.
   * Un error de nombre produce perdida silenciosa de datos (ni log ni excepcion). */

  /* 'meta' en vez de 'metaEntrada': PostSyncHandler usa $definition['metaEntrada'] para
   * meta_input de wp_insert_post. Con 'meta' el post se crea sin ningun metadato. */
  { id: 'glory-meta-clave-incorrecta', nombre: "'meta' en vez de 'metaEntrada'", severidadDefault: 'error', categoria: CategoriaRegla.GlorySchema },

  /* 'slug' en vez de 'slugDefault': DefaultContentSynchronizer usa $definition['slugDefault']
   * para findPorSlug(). Si falta, cada sync CREA un post nuevo en vez de actualizar
   * el existente — duplicacion infinita en cada activacion del tema. */
  { id: 'glory-slug-clave-incorrecta', nombre: "'slug' en vez de 'slugDefault'", severidadDefault: 'error', categoria: CategoriaRegla.GlorySchema },

  /* 'title' en vez de 'titulo': prepareCorePostData() usa $definition['titulo'] para
   * post_title. Con 'title' el post se crea con titulo vacio. */
  { id: 'glory-titulo-clave-incorrecta', nombre: "'title'/'name' en vez de 'titulo'", severidadDefault: 'error', categoria: CategoriaRegla.GlorySchema },

  /* 'imagen'/'image' en vez de 'imagenDestacadaAsset': PostRelationHandler::setFeaturedImage()
   * hace isset($definicion['imagenDestacadaAsset']) — si la clave no existe, no asigna
   * imagen destacada sin ningun aviso. */
  { id: 'glory-imagen-clave-incorrecta', nombre: "'imagen' en vez de 'imagenDestacadaAsset'", severidadDefault: 'warning', categoria: CategoriaRegla.GlorySchema },

  /* 'galeria'/'gallery' en vez de 'galeriaAssets': PostRelationHandler::setGallery()
   * usa la clave 'galeriaAssets'. Error tipico de mezclar ingles/espanol. */
  { id: 'glory-galeria-clave-incorrecta', nombre: "'galeria'/'gallery' en vez de 'galeriaAssets'", severidadDefault: 'warning', categoria: CategoriaRegla.GlorySchema },

  /* 'content'/'contenido_html' en vez de 'contenido': prepareCorePostData() usa
   * $definition['contenido'] para post_content. Silencioso: post con contenido vacio. */
  { id: 'glory-contenido-clave-incorrecta', nombre: "'content' en vez de 'contenido'", severidadDefault: 'warning', categoria: CategoriaRegla.GlorySchema },

  /* --- Sprint 3: CSS (staticAnalyzer.ts) --- */
  /* habilitadaDefault: false — demasiados falsos positivos con clases nativas (.input, .select, .button)
   * que no conviene renombrar (formularios WordPress, librerías externas). */
  { id: 'nomenclatura-css-ingles', nombre: 'CSS en ingles', severidadDefault: 'hint', habilitadaDefault: false, categoria: CategoriaRegla.EstructuraNomenclatura },
  /* css-hardcoded-value: desactivada. Descomentar para re-activar. */
  // { id: 'css-hardcoded-value', nombre: 'Color CSS hardcodeado', severidadDefault: 'warning', categoria: CategoriaRegla.EstructuraNomenclatura },

  /* --- Sprint 4: React (reactAnalyzer.ts) --- */
  { id: 'html-nativo-en-vez-de-componente', nombre: 'HTML nativo en vez de componente', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },

  /* --- Sprint 5: Detecciones avanzadas (reactAnalyzer.ts + staticAnalyzer.ts) --- */
  { id: 'componente-artesanal', nombre: 'Componente artesanal detectado', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'fallo-sin-feedback', nombre: 'Catch sin feedback al usuario', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'update-optimista-sin-rollback', nombre: 'Update optimista sin rollback', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'fetch-sin-timeout', nombre: 'fetch() sin timeout', severidadDefault: 'hint', categoria: CategoriaRegla.ReactPatrones },
  { id: 'non-null-assertion-excesivo', nombre: 'Non-null assertion excesivo', severidadDefault: 'hint', categoria: CategoriaRegla.EstructuraNomenclatura },

  /* --- Sprint 9: React/TS nuevas detecciones --- */
  { id: 'listen-sin-cleanup', nombre: 'listen() sin cleanup', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'status-http-generico', nombre: 'Status HTTP marca exito sin body', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'handler-sin-trycatch', nombre: 'Handler async sin try-catch', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'cola-sin-limite', nombre: 'push() a cola sin limite', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },
  { id: 'objeto-mutable-exportado', nombre: 'Objeto mutable exportado', severidadDefault: 'hint', categoria: CategoriaRegla.ReactPatrones },

  /* --- Constantes PHP (gloryAnalyzer.ts) --- */
  { id: 'undefined-class-constant', nombre: 'Constante de clase indefinida', severidadDefault: 'error', categoria: CategoriaRegla.GlorySchema },

  /* --- Contrato API (apiContractRules.ts) --- */
  { id: 'api-response-mismatch', nombre: 'Mismatch clave API PHP vs TS', severidadDefault: 'error', categoria: CategoriaRegla.GlorySchema },
  { id: 'acceso-api-sin-fallback', nombre: 'Acceso a data.campo sin fallback', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },

  /* --- Sprint 11: Shape mismatch PHP↔TS (apiContractRules.ts + phpArrayShapeRules.ts) ---
   * Detectan cuando PHP devuelve array asociativo (→ JSON {}) pero TS espera Type[] (→ JSON []).
   * El caso clasico: $arr[$key] = valor en PHP causa 'h.map is not a function' en React. */
  { id: 'api-shape-mismatch', nombre: 'Shape mismatch array PHP vs TS', severidadDefault: 'error', categoria: CategoriaRegla.GlorySchema },
  { id: 'php-array-asociativo-como-lista', nombre: 'Array asociativo retornado como lista', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },
  { id: 'php-service-retorna-asociativo', nombre: 'Service retorna asociativo en vez de lista', severidadDefault: 'warning', categoria: CategoriaRegla.WordPressPhp },

  /* --- React/TS: emoji y estilos inline --- */
  { id: 'emoji-en-codigo', nombre: 'Emoji Unicode en codigo', severidadDefault: 'warning', categoria: CategoriaRegla.PatronesProhibidos },
  { id: 'inline-style-prohibido', nombre: 'CSS inline con style={{}}', severidadDefault: 'warning', categoria: CategoriaRegla.ReactPatrones },

  /* --- Deteccion de TODOs/pendientes (defaultRules.ts) --- */
  { id: 'todo-pendiente', nombre: 'TODO/FIXME pendiente detectado', severidadDefault: 'hint', categoria: CategoriaRegla.EstructuraNomenclatura },
];

/* Cache de configuracion: se construye lazily al primer acceso */
let configCache: Map<string, ConfigReglaEfectiva> | null = null;

/* Severidades validas para validacion de input del usuario */
const SEVERIDADES_VALIDAS = new Set<SeveridadRegla>(['error', 'warning', 'information', 'hint']);

/* Construye el cache leyendo los overrides del usuario desde settings.json */
function construirCache(): Map<string, ConfigReglaEfectiva> {
  const mapa = new Map<string, ConfigReglaEfectiva>();

  let overrides: Record<string, ConfigReglaUsuario> = {};
  try {
    const config = vscode.workspace.getConfiguration('codeSentinel');
    overrides = config.get<Record<string, ConfigReglaUsuario>>('rules', {});
  } catch {
    /* Si falla la lectura de config, usar defaults */
  }

  for (const regla of REGISTRO) {
    const override = overrides[regla.id];

    /* Validar severidad del usuario para no aceptar valores invalidos */
    const severidadUsuario = override?.severidad;
    const severidadFinal = severidadUsuario && SEVERIDADES_VALIDAS.has(severidadUsuario)
      ? severidadUsuario
      : regla.severidadDefault;

    mapa.set(regla.id, {
      habilitada: override?.habilitada ?? (regla.habilitadaDefault ?? true),
      severidad: severidadFinal,
    });
  }

  return mapa;
}

/* Obtiene el cache, construyendolo si no existe */
function obtenerCache(): Map<string, ConfigReglaEfectiva> {
  if (!configCache) {
    configCache = construirCache();
  }
  return configCache;
}

/* Verifica si una regla esta habilitada. Reglas no registradas se asumen activas. */
export function reglaHabilitada(id: string): boolean {
  return obtenerCache().get(id)?.habilitada ?? true;
}

/* Obtiene la severidad configurada para una regla */
export function obtenerSeveridadRegla(id: string): SeveridadRegla {
  return obtenerCache().get(id)?.severidad ?? 'warning';
}

/* Invalida el cache para forzar recarga desde settings.json */
export function invalidarRegistroReglas(): void {
  configCache = null;
}

/*
 * Retorna todas las definiciones con su configuracion efectiva actual.
 * Se usa para el panel de resumen y la generacion de reportes.
 */
export function obtenerTodasLasReglas(): Array<DefinicionRegla & ConfigReglaEfectiva> {
  const cache = obtenerCache();
  return REGISTRO.map(r => ({
    ...r,
    habilitada: cache.get(r.id)?.habilitada ?? true,
    severidad: cache.get(r.id)?.severidad ?? r.severidadDefault,
  }));
}
