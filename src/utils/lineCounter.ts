/*
 * Conteo de lineas efectivas excluyendo comentarios y lineas vacias.
 * Se usa para verificar limites de archivo segun el protocolo (Seccion 3).
 */

/* Cuenta lineas efectivas excluyendo comentarios (bloque y linea) y lineas vacias */
export function contarLineasEfectivas(texto: string): number {
  const lineas = texto.split('\n');
  let enComentarioBloque = false;
  let cuenta = 0;

  for (const linea of lineas) {
    const trimmed = linea.trim();

    /* Detectar inicio de comentario de bloque */
    if (!enComentarioBloque && trimmed.startsWith('/*')) {
      enComentarioBloque = true;
      /* Si el bloque se cierra en la misma linea */
      if (trimmed.includes('*/') && !trimmed.endsWith('/*')) {
        enComentarioBloque = false;
      }
      continue;
    }

    /* Dentro de un comentario de bloque */
    if (enComentarioBloque) {
      if (trimmed.includes('*/')) {
        enComentarioBloque = false;
      }
      continue;
    }

    /* Saltar lineas vacias y comentarios de linea */
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) {
      continue;
    }

    cuenta++;
  }

  return cuenta;
}

/*
 * Determina el tipo de limite de lineas segun el nombre y ruta del archivo.
 * Retorna null si no aplica ningun limite especial.
 */
export interface LimiteArchivo {
  tipo: 'componente' | 'hook' | 'util' | 'estilo';
  limite: number;
}

export function obtenerLimiteArchivo(nombreArchivo: string, rutaArchivo: string): LimiteArchivo | null {
  const nombreLower = nombreArchivo.toLowerCase();
  const rutaLower = rutaArchivo.toLowerCase().replace(/\\/g, '/');

  /* Hooks: archivos use*.ts o use*.tsx */
  if (/^use[A-Z]/.test(nombreArchivo) && (nombreLower.endsWith('.ts') || nombreLower.endsWith('.tsx'))) {
    return { tipo: 'hook', limite: 120 };
  }

  /* Utils: archivos dentro de carpetas utils/ o helpers/ */
  if (rutaLower.includes('/utils/') || rutaLower.includes('/helpers/')) {
    return { tipo: 'util', limite: 150 };
  }

  /* Estilos: archivos .css */
  if (nombreLower.endsWith('.css')) {
    return { tipo: 'estilo', limite: 300 };
  }

  /* Componentes: archivos .tsx, .jsx */
  if (nombreLower.endsWith('.tsx') || nombreLower.endsWith('.jsx')) {
    return { tipo: 'componente', limite: 300 };
  }

  /* PHP: archivos .php (controladores, servicios, etc.) */
  if (nombreLower.endsWith('.php')) {
    return { tipo: 'componente', limite: 300 };
  }

  return null;
}
