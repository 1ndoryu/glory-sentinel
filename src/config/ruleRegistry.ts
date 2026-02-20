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
  { id: 'css-inline-jsx', nombre: 'CSS inline en JSX', severidadDefault: 'warning', categoria: CategoriaRegla.CssEstilos },
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

  /* --- CSS (cssAnalyzer.ts) --- */
  { id: 'css-color-hardcodeado', nombre: 'Color CSS hardcodeado', severidadDefault: 'information', categoria: CategoriaRegla.CssEstilos },
  { id: 'css-nomenclatura-ingles', nombre: 'CSS en ingles', severidadDefault: 'information', categoria: CategoriaRegla.CssEstilos },
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
