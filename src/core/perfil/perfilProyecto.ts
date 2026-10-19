/*
 * Detecta si el proyecto es WordPress o Glory por marcadores de carpeta y archivo.
 * Sus reglas vienen desactivadas por defecto (en un proyecto ajeno dan falsos
 * positivos), asi que aqui solo se recomienda activarlas: nunca se activan solas.
 */
import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { CategoriaRegla } from '../../types';
import { obtenerTodasLasReglas } from '../../config/ruleRegistry';
import { analyzerSubConfig, validateSentinelConfig } from '../runtime-proyecto/config';

export interface PerfilProyecto {
  wordpress: boolean;
  glory: boolean;
}

/* Acotado: los marcadores viven cerca de la raiz y el recorrido no debe crecer con el repo */
const PROFUNDIDAD_MAX = 3;
const DIRECTORIOS_MAX = 2000;
const IGNORADOS = new Set(['node_modules', 'vendor', '.git', 'out', 'dist', 'build', 'target', '.agent', 'Agente']);
const ARCHIVOS_WORDPRESS = new Set(['wp-config.php', 'wp-config-sample.php']);

/* Categorias de reglas que pertenecen a cada perfil */
const CATEGORIAS_PERFIL: Record<keyof PerfilProyecto, CategoriaRegla[]> = {
  wordpress: [CategoriaRegla.WordPressPhp],
  glory: [CategoriaRegla.GlorySchema],
};

export async function detectarPerfilProyecto(raiz: string): Promise<PerfilProyecto> {
  const perfil: PerfilProyecto = { wordpress: false, glory: false };
  const contador = { directorios: 0 };
  await recorrer(raiz, 0, perfil, contador);
  return perfil;
}

async function recorrer(dir: string, profundidad: number, perfil: PerfilProyecto, contador: { directorios: number }): Promise<void> {
  // Sin acceso a una carpeta se sigue con el resto: no es un fallo del analisis
  let entradas: Dirent[];
  try {
    entradas = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  contador.directorios += 1;
  for (const entrada of entradas) {
    if (entrada.isDirectory()) {
      if (entrada.name === 'Glory') perfil.glory = true;
      if (entrada.name === 'wp-content') perfil.wordpress = true;
    } else if (entrada.isFile()) {
      if (ARCHIVOS_WORDPRESS.has(entrada.name)) perfil.wordpress = true;
      if (entrada.name === 'style.css' && await esTemaWordPress(path.join(dir, entrada.name))) perfil.wordpress = true;
    }
  }
  if (profundidad >= PROFUNDIDAD_MAX) return;
  for (const entrada of entradas) {
    if (contador.directorios >= DIRECTORIOS_MAX) return;
    if (entrada.isDirectory() && !IGNORADOS.has(entrada.name)) {
      await recorrer(path.join(dir, entrada.name), profundidad + 1, perfil, contador);
    }
  }
}

// El tema de WordPress declara "Theme Name:" en la cabecera de style.css
async function esTemaWordPress(archivo: string): Promise<boolean> {
  try {
    const cabecera = (await fs.readFile(archivo, 'utf8')).slice(0, 4096);
    return /Theme Name:/i.test(cabecera);
  } catch {
    return false;
  }
}

/* Reglas de un perfil que el usuario aun no ha activado en sentinel.config.json */
async function reglasPerfilSinActivar(raiz: string, perfil: keyof PerfilProyecto): Promise<string[]> {
  const categorias = new Set<CategoriaRegla>(CATEGORIAS_PERFIL[perfil]);
  const activadasPorUsuario = await reglasActivadasPorUsuario(raiz);
  return obtenerTodasLasReglas()
    .filter(regla => categorias.has(regla.categoria) && !activadasPorUsuario.has(regla.id))
    .map(regla => regla.id);
}

/* Ids con `habilitada: true` en la config; una config invalida no activa nada aqui */
async function reglasActivadasPorUsuario(raiz: string): Promise<Set<string>> {
  try {
    const crudo: unknown = JSON.parse(await fs.readFile(path.join(raiz, 'sentinel.config.json'), 'utf8'));
    validateSentinelConfig(crudo);
    const reglas = analyzerSubConfig(crudo).rules ?? {};
    return new Set(Object.keys(reglas).filter(id => reglas[id]?.habilitada === true));
  } catch {
    return new Set();
  }
}

/* Recordatorios para el informe del gate: uno por perfil detectado con reglas sin activar */
export async function recomendacionesPerfil(raiz: string): Promise<string[]> {
  const perfil = await detectarPerfilProyecto(raiz);
  const recomendaciones: string[] = [];
  for (const nombre of ['wordpress', 'glory'] as const) {
    if (!perfil[nombre]) continue;
    const pendientes = await reglasPerfilSinActivar(raiz, nombre);
    if (pendientes.length === 0) continue;
    const etiqueta = nombre === 'wordpress' ? 'WordPress' : 'Glory';
    recomendaciones.push(
      `Proyecto ${etiqueta} detectado: ${pendientes.length} reglas desactivadas por defecto. ` +
      'Para activarlas, en sentinel.config.json añade bajo "rules" { "<id>": { "habilitada": true } } (ids en rules.md).',
    );
  }
  return recomendaciones;
}
