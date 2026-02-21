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

  /* --- Sprint 3: CSS (staticAnalyzer.ts) --- */
  { id: 'nomenclatura-css-ingles', nombre: 'CSS en ingles', severidadDefault: 'hint', categoria: CategoriaRegla.EstructuraNomenclatura },
  { id: 'css-hardcoded-value', nombre: 'Color CSS hardcodeado', severidadDefault: 'warning', categoria: CategoriaRegla.EstructuraNomenclatura },

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
      habilitada: override?.habilitada ?? true,
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
