/* [M-S3] Validadores de los bloques de sentinel.config.json añadidos después. Viven aparte
 * para que config.ts no supere el límite de líneas por archivo. */
import { PERFILES_EXENCION } from '../../../config/perfilesExencion';

const EXENCIONES_KEYS = new Set(['perfil', 'rutas', 'componentes']);

export function assertStringArray(value: unknown, key: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`sentinel.config.json: '${key}' debe ser string[]`);
  }
}

/* Rechaza `exenciones` si no es un objeto, trae claves desconocidas, un perfil inexistente
 * o listas que no son de texto. Sin clave, el analisis no exime nada (opt-in). */
export function validarExenciones(valor: unknown): void {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error("sentinel.config.json: 'exenciones' debe ser un objeto");
  }
  const exenciones = valor as Record<string, unknown>;
  for (const clave of Object.keys(exenciones)) {
    if (!EXENCIONES_KEYS.has(clave)) {
      throw new Error(`sentinel.config.json: clave desconocida 'exenciones.${clave}'`);
    }
  }
  const perfiles = Object.keys(PERFILES_EXENCION);
  if (exenciones.perfil !== undefined && !perfiles.includes(exenciones.perfil as string)) {
    throw new Error(`sentinel.config.json: 'exenciones.perfil' desconocido (válidos: ${perfiles.join(', ')})`);
  }
  if (exenciones.rutas !== undefined) assertStringArray(exenciones.rutas, 'exenciones.rutas');
  if (exenciones.componentes !== undefined) assertStringArray(exenciones.componentes, 'exenciones.componentes');
}
