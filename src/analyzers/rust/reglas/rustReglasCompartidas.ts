export const REGLA_EXPECT = 'expect-produccion-rs';
export const REGLA_BLOCK = 'block-en-async-rs';
export const REGLA_LOCK_AWAIT = 'lock-a-traves-await-rs';

/* [149A-1] Ids de la segunda hornada (severidades en ruleRegistry.ts). */
export const REGLA_SQLITE_MUTEX = 'rusqlite-bloqueante-en-async';
export const REGLA_SHELL = 'shell-modelo-sin-allowlist';
export const REGLA_SECRETO_LOG = 'secreto-en-log';
export const REGLA_POST_SIN_RL = 'ruta-post-sin-rate-limit';
export const REGLA_PATH_JOIN = 'path-join-sin-canonicalize';
export const REGLA_N_CONSULTAS = 'sqlite-carga-N-consultas';
export const REGLA_CLONE_LOCK = 'clone-bajo-lock-rs';
export const REGLA_GOD_OBJECT = 'god-object-rs';
export const REGLA_PORT_FS = 'port-fs-duplicado-rs';

export function tieneDisableSiguiente(lineas: string[], i: number, reglaId: string): boolean {
  return i > 0 && lineas[i - 1].includes(`sentinel-disable-next-line ${reglaId}`);
}
/* Devuelve el set de lineas que caen dentro del cuerpo de una funcion
 * async (fn, closure async move/async {}) o de un #[tokio::main]/#[tokio::test]
 * (main/test async). Heuristica por llaves; suficiente para el gate. */
export function calcularRangosAsync(lineas: string[]): Set<number> {
  const rangos = new Set<number>();
  const patronInicioAsync = /(?:^|\s)(?:async\s+(?:fn|move)|async\s*\{)|#\[(?:tokio|async_std)::(?:main|test)\]/;

  let dentro = false;
  let profundidad = 0;
  let inicio = 0;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (!dentro && patronInicioAsync.test(linea)) {
      /* Saltar la propia linea de declaracion: el cuerpo empieza en la { */
      dentro = true;
      inicio = i;
      profundidad = 0;
    }

    if (dentro) {
      for (const ch of linea) {
        if (ch === '{') { profundidad++; }
        if (ch === '}') {
          profundidad--;
          if (profundidad <= 0 && i > inicio) {
            dentro = false;
            break;
          }
        }
      }
      if (dentro) { rangos.add(i); }
    }
  }

  return rangos;
}

/* Devuelve el set de lineas dentro de los parentesis de una llamada a
 * spawn_blocking: ahi el bloqueo ya esta aislado del runtime async (es el
 * fix que recomiendan rusqlite-bloqueante-rs y lock-a-traves-await-rs).
 * Balance de parentesis desde la linea de la llamada (el closure vive
 * dentro); vale tanto para `spawn_blocking(|| { ... })` como para
 * `spawn_blocking(|| expr)` sin llaves. */
export function calcularRangosSpawnBlocking(lineas: string[]): Set<number> {
  const rangos = new Set<number>();
  const patronInicio = /spawn_blocking\s*\(/;

  let dentro = false;
  let profundidad = 0;
  let inicio = 0;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (!dentro && patronInicio.test(linea)) {
      dentro = true;
      inicio = i;
      profundidad = 0;
    }

    if (dentro) {
      rangos.add(i);
      for (const ch of linea) {
        if (ch === '(') { profundidad++; }
        if (ch === ')') {
          profundidad--;
          if (profundidad <= 0 && i > inicio) {
            dentro = false;
            break;
          }
        }
      }
      /* Llamada de una sola linea (balance 0 en la propia linea de
       * inicio): cerrar sin tragar el resto del fichero. */
      if (dentro && i === inicio && profundidad <= 0) {
        dentro = false;
      }
    }
  }

  return rangos;
}

export interface GuardActivo {
  nombre: string;
  profundidad: number;
  linea: number;
}

/* Regresa [inicio, fin] (indices inclusivos) de cada cuerpo de funcion
 * no-test detectado, reutilizando la heuristica de analizarFunciones. */
export function rangosFunciones(lineas: string[], rangoTests: Set<number>): Array<[number, number]> {
  const rangos: Array<[number, number]> = [];
  const patronFn = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+\w+\s*(?:<[^>]*>)?\s*\(/;

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }
    if (!patronFn.test(lineas[i])) { continue; }

    let profundidad = 0;
    let abrio = false;
    let fin = -1;
    for (let j = i; j < lineas.length; j++) {
      for (const ch of lineas[j]) {
        if (ch === '{') { abrio = true; profundidad++; }
        if (ch === '}') {
          profundidad--;
          if (profundidad === 0 && abrio) { fin = j; break; }
        }
      }
      if (fin !== -1) { break; }
    }
    if (fin !== -1) { rangos.push([i, fin]); i = fin; }
  }

  return rangos;
}

export const PATRON_LOCK_SYNC = /let\s+(\w+)\s*=\s*[^;\n]*?\.lock\s*\(\s*\)(?!\s*\.await)/;
