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
  tipo: 'componente' | 'hook' | 'util' | 'estilo' | 'controlador' | 'servicio';
  limite: number;
}

export function obtenerLimiteArchivo(nombreArchivo: string, rutaArchivo: string): LimiteArchivo | null {
  const nombreLower = nombreArchivo.toLowerCase();
  const rutaLower = rutaArchivo.toLowerCase().replace(/\\/g, '/');

  /* Hooks: archivos use*.ts o use*.tsx.
   * Feature hooks (extraidos de islands/componentes) necesitan mas espacio
   * que small reusable hooks. Limite ajustado a 200 (protocolo base: 120,
   * pero la extraccion SRP inherentemente agrupa logica de pagina completa). */
  if (/^use[A-Z]/.test(nombreArchivo) && (nombreLower.endsWith('.ts') || nombreLower.endsWith('.tsx'))) {
    return { tipo: 'hook', limite: 200 };
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

  /* PHP: categorizar segun ubicacion en el proyecto.
   * El protocolo (Seccion 3) define limites para componentes/estilos/hooks/utils
   * del frontend. Para PHP se usan limites razonables segun la capa. */
  if (nombreLower.endsWith('.php')) {
    /* Seeders, migraciones, schemas y config no tienen limite estricto
     * ya que su longitud depende de la cantidad de datos/tablas */
    if (rutaLower.includes('/database/') || rutaLower.includes('/config/') ||
        rutaLower.includes('/schema/') || nombreLower.includes('seeder') ||
        nombreLower.includes('migration') || nombreLower.includes('schema')) {
      return null;
    }

    /* Controladores/Endpoints: deben ser delgados (300 lineas) */
    if (rutaLower.includes('/api/') || rutaLower.includes('/endpoints/') ||
        rutaLower.includes('/controllers/') || nombreLower.includes('endpoint') ||
        nombreLower.includes('controller')) {
      return { tipo: 'controlador', limite: 300 };
    }

    /* Servicios y modelos: logica de negocio permite mas extensión (400 lineas) */
    if (rutaLower.includes('/services/') || rutaLower.includes('/models/') ||
        nombreLower.includes('service') || nombreLower.includes('model')) {
      return { tipo: 'servicio', limite: 400 };
    }

    /* PHP general: utilidades, helpers PHP, etc. */
    return { tipo: 'componente', limite: 300 };
  }

  return null;
}
