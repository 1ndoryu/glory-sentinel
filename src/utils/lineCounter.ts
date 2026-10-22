/*
 * Conteo de lineas efectivas excluyendo comentarios y lineas vacias.
 * Se usa para verificar limites de archivo segun el protocolo (Seccion 3).
 */

/* Devuelve el offset del `#[cfg(test)]` que introduce el modulo de tests
 * —aquel cuyo codigo siguiente es un `mod`—, o -1 si no hay ninguno.
 * [16AA-8] No vale el primero del archivo: un `#[cfg(test)] use ...` en la
 * cabecera (import que solo usan los tests) truncaba el archivo entero y el
 * limite de lineas no saltaba nunca. Se toma el ultimo `mod` para no cortar
 * por un `#[cfg(test)] mod` de un submodulo intermedio. */
function offsetModuloDeTests(texto: string): number {
  const atributo = '#[cfg(test)]';
  const lineas = texto.split('\n');
  let offset = 0;
  let encontrado = -1;

  for (let i = 0; i < lineas.length; i++) {
    const idx = lineas[i].indexOf(atributo);
    if (idx !== -1) {
      const mismoRenglon = lineas[i].slice(idx + atributo.length).trim();
      const siguiente = mismoRenglon !== '' ? mismoRenglon : (lineas[i + 1] ?? '').trim();
      if (/^mod\s/.test(siguiente)) {
        encontrado = offset + idx;
      }
    }
    offset += lineas[i].length + 1;
  }

  return encontrado;
}

/* Cuenta lineas efectivas excluyendo comentarios (bloque y linea) y lineas vacias.
 * Si esRust=true, excluye el modulo #[cfg(test)] (los tests no son complejidad de
 * produccion, y en Rust es convencion tenerlos al final del mismo archivo). */
export function contarLineasEfectivas(texto: string, esRust: boolean = false): number {
  /* Para Rust: truncar en el modulo de tests — los tests viven al final del
   * archivo y no contribuyen a la complejidad de mantenimiento del codigo de
   * produccion. */
  if (esRust) {
    const idxTest = offsetModuloDeTests(texto);
    if (idxTest !== -1) {
      texto = texto.substring(0, idxTest);
    }
  }
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
  tipo: 'componente' | 'hook' | 'util' | 'estilo' | 'controlador' | 'servicio' | 'repositorio' | 'modelo' | 'test-integracion';
  limite: number;
}

/* ¿Es un archivo de pruebas? Por nombre (`.test.`/`.spec.` antes de la extension)
 * o por carpeta (`/test/`, `/tests/`, `/__tests__/`). */
export function esArchivoDeTests(nombreLower: string, rutaLower: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(nombreLower) || /\/(__tests__|tests?)\//.test(rutaLower);
}

export function obtenerLimiteArchivo(nombreArchivo: string, rutaArchivo: string): LimiteArchivo | null {
  const nombreLower = nombreArchivo.toLowerCase();
  const rutaLower = rutaArchivo.toLowerCase().replace(/\\/g, '/');

  /* [054A-19] Archivos de datos puros (constantes, arrays estaticos) no tienen limite.
   * Convencional: archivos .ts bajo /data/ que solo exportan constantes. */
  if (rutaLower.includes('/data/') && (nombreLower.endsWith('.ts') || nombreLower.endsWith('.js'))) {
    return null;
  }

  /* [17AA-2 FP] Ficheros de pruebas: mismo techo que el harness de integracion de
   * Rust (1000), que es el precedente de este archivo. Un archivo de tests no es
   * complejidad de produccion: en Rust, `contarLineasEfectivas` ya excluye el
   * modulo `#[cfg(test)]` por esa misma razon. Sin esta rama, un `.test.ts` o un
   * `.test.mjs` caia en el techo de componente (300) y un archivo de pruebas sano
   * salia como hallazgo (dos archivos de pruebas reales de 516 y 398 lineas
   * efectivas en un consumidor). */
  if (esArchivoDeTests(nombreLower, rutaLower)) {
    return { tipo: 'test-integracion', limite: 1000 };
  }

  /* Hooks: archivos use*.ts o use*.tsx.
   * Feature hooks (extraidos de islands/componentes) necesitan mas espacio
   * que small reusable hooks. Limite ajustado a 300 (protocolo base: 120,
   * pero la extraccion SRP inherentemente agrupa logica de pagina completa
   * y un hook de isla puede tener tanta logica como el componente original). */
  if (/^use[A-Z]/.test(nombreArchivo) && (nombreLower.endsWith('.ts') || nombreLower.endsWith('.tsx'))) {
    return { tipo: 'hook', limite: 300 };
  }

  /* Utils: archivos dentro de carpetas utils/ o helpers/ */
  if (rutaLower.includes('/utils/') || rutaLower.includes('/helpers/')) {
    return { tipo: 'util', limite: 150 };
  }

  /* Estilos: archivos .css */
  if (nombreLower.endsWith('.css')) {
    return { tipo: 'estilo', limite: 600 };
  }

  /* Componentes: archivos .tsx, .jsx */
  if (nombreLower.endsWith('.tsx') || nombreLower.endsWith('.jsx')) {
    return { tipo: 'componente', limite: 300 };
  }

  /* TypeScript puro (.ts, excluyendo .d.ts que ya fue filtrado como hook/util).
   * Servicios, stores y models TS siguen misma logica que PHP. */
  if (nombreLower.endsWith('.ts') && !nombreLower.endsWith('.d.ts')) {
    if (rutaLower.includes('/services/') || rutaLower.includes('/models/') ||
        nombreLower.includes('service') || nombreLower.includes('model')) {
      return { tipo: 'servicio', limite: 400 };
    }
    if (rutaLower.includes('/stores/')) {
      return { tipo: 'servicio', limite: 400 };
    }
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

  /* Rust: categorizar segun ubicacion en el proyecto.
   * Handlers y services: 500 lineas (logica compleja pero acotada)
   * Repositories y models: 400/300 lineas (deben ser delgados)
   * bin/, migrations/, examples/: sin limite (runners, scripts de datos) */
  if (nombreLower.endsWith('.rs')) {
    /* [FP-S4 11-09-2026] Harnesses de tests de integración: rutas /tests/ o
     * sufijos _test.rs/_tests.rs tienen tipo propio calibrado (1000) en vez
     * del default servicio/500. Un harness legítimo supera 500 sin ser deuda
     * BASTA; con 1000, el nivel-3 exige >3000 efectivas y el nivel-2 >2000. */
    if (rutaLower.includes('/tests/') || nombreLower.endsWith('_test.rs') ||
        nombreLower.endsWith('_tests.rs')) {
      return { tipo: 'test-integracion', limite: 1000 };
    }

    if (rutaLower.includes('/bin/') || rutaLower.includes('/migrations/') ||
        rutaLower.includes('/examples/') || nombreLower === 'build.rs') {
      return null;
    }

    if (rutaLower.includes('/handlers/')) {
      return { tipo: 'controlador', limite: 500 };
    }

    /* Rust es mas verboso que TS/PHP: type annotations, macros SQL,
     * error handling con ?, lifetimes. Limites calibrados +40% vs PHP. */
    if (rutaLower.includes('/services/')) {
      return { tipo: 'servicio', limite: 700 };
    }

    if (rutaLower.includes('/repositories/')) {
      return { tipo: 'repositorio', limite: 550 };
    }

    if (rutaLower.includes('/models/')) {
      return { tipo: 'modelo', limite: 300 };
    }

    return { tipo: 'servicio', limite: 500 };
  }

  /* Scripts JS/MJS/CJS (CLI, tooling, dev): techo de componente. Antes no tenían
   * límite y un script de 1800 líneas (doctor.mjs) pasaba sin aviso.
   * [17AA-2] `.cjs` faltaba aquí y en `DEFAULT_INCLUDE_PATTERNS`: el resto del
   * núcleo ya lo trata como JavaScript (`language.ts` lo mapea a `.js`,
   * `EXTENSIONES_CODIGO` lo incluye, el perfil lo clasifica `web`), así que un
   * `.cjs` no se recolectaba nunca y, si lo hubiera hecho, caía en el `null`
   * final: sin techo, sin reglas por extensión. Es CommonJS, no otra cosa. */
  if (nombreLower.endsWith('.mjs') || nombreLower.endsWith('.cjs') || nombreLower.endsWith('.js')) {
    return { tipo: 'componente', limite: 300 };
  }

  return null;
}
