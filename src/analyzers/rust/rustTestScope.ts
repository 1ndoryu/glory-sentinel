/* [079A-1 F6] Alcance de solo-test compartido por las reglas Rust.
 *
 * Archivo completo de solo-test declarado con atributo interno #![cfg(test)]
 * (p. ej. modulo de tests partido a fichero propio e incluido desde el padre
 * bajo #[cfg(test)], o modulo de contrato). La heuristica por rangos no ve la
 * declaracion en el fichero padre, asi que el atributo interno es el marcador
 * honesto de "solo compila en tests". Extraido de rustReglasNuevas.ts (902c45e)
 * para reutilizarlo en rustAnalyzer.ts sin duplicar ni romper el budget. */

const ES_ARCHIVO_TEST = /(?:^|\r?\n)\s*#!\[cfg\(test\)\]/;

export function esArchivoSoloTest(texto: string): boolean {
  return ES_ARCHIVO_TEST.test(texto);
}

/* [16A-8] Alcance de solo-test por RUTA, que es el criterio que el atributo
 * interno no puede dar.
 *
 * Rust tiene tres convenciones para "este fichero solo compila en tests":
 *
 *   1. `tests/<x>.rs`     — tests de integracion del crate (cargo).
 *   2. `<mod>/tests.rs`   — modulo de tests partido a fichero propio.
 *   3. atributo interno `#![cfg(test)]`.
 *
 * La 3 la cubre `esArchivoSoloTest`. En la 1 y la 2 el `#[cfg(test)]` que las
 * habilita vive en el fichero PADRE, asi que el fichero de test no lleva ni el
 * atributo interno ni un bloque `#[cfg(test)] mod`, y `calcularRangosTest` no
 * encuentra nada que marcar.
 *
 * Medido en KAMPLES el 2026-10-16: de 109 hallazgos de `expect-produccion-rs`,
 * 103 estaban en ficheros `tests.rs` — el 94 % de la regla era falso positivo.
 * El mismo hueco afectaba a `unwrap-produccion-rs` (3 de 4) y a
 * `ruta-post-sin-rate-limit` (4 de 65).
 *
 * [16A-8] Las dos convenciones NO se tratan igual, y la diferencia importa:
 *
 *   - `tests/` es decision de cargo: todo lo que hay ahi es test de
 *     integracion. Basta la ruta.
 *   - `<mod>/tests.rs` solo es test si ALGUIEN lo declara bajo `#[cfg(test)]`.
 *     El nombre por si solo no prueba nada: un modulo de produccion puede
 *     llamarse `tests.rs`. Por eso se exige la evidencia — leer el padre y ver
 *     el `#[cfg(test)]` — en vez de fiarse del nombre. Decision 08AA-26, que
 *     tenia su test (`sqlxSoloProduccionTest`) y sigue cumpliendose: sin padre
 *     que lo declare, un `tests.rs` SIGUE disparando. */

import * as fs from 'fs';
import * as path from 'path';

const ES_DIRECTORIO_DE_TEST = /(^|\/)tests\//;
const ES_NOMBRE_DE_TEST = /(^|\/)(tests?\.rs)$/;

/* Atributos que pueden ir entre el `#[cfg(test)]` y el `mod`: en la practica
 * solo `#[path = "..."]`, que es como se apunta a un fichero de test que no
 * sigue la convencion de nombre. Se acota la distancia para no emparejar un
 * `#[cfg(test)]` con un `mod` que no tiene nada que ver. */
const VENTANA_ATRIBUTOS = 240;

/* Cache por directorio: el analisis recorre muchos ficheros y la respuesta
 * depende de los hermanos, no del fichero. Mismo criterio que
 * `cacheRateLimitToml` en rustReglasRutas.ts. */
const cache = new Map<string, boolean>();

/* ¿Algun hermano declara ESTE fichero bajo `#[cfg(test)]`?
 *
 * Se busca `#[cfg(test)]` seguido del `mod <nombre>;` que corresponde al
 * fichero (`tests.rs` -> `mod tests;`), o de un `#[path = "..."]` que lo
 * nombre. Cualquier fallo de lectura cuenta como "no hay evidencia": sin
 * padre, la regla vuelve a disparar, que es el lado seguro. */
/* Ficheros donde puede estar la declaracion de `<dir>/<nombre>.rs`.
 *
 * El modulo dueño de un directorio vive DENTRO (`<dir>/mod.rs`) o FUERA
 * (`<dir>.rs`, hermano del directorio). En KAMPLES gana el de fuera:
 * `src/audio/bpm/tests.rs` lo declara `src/audio/bpm.rs:378`. Mirar solo los
 * hermanos del fichero dejaba 93 de los 99 `expect-produccion-rs` sin excluir.
 *
 * NO se sube un nivel mas (`<dirPadre>/mod.rs`): un `mod tests;` ahi resolveria
 * a `<dirPadre>/tests.rs`, no a este fichero. */
function ficherosDeclarantes(dir: string): string[] {
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidatos = entradas
    .filter(entrada => entrada.isFile() && entrada.name.endsWith('.rs'))
    .map(entrada => path.join(dir, entrada.name));
  candidatos.push(path.join(path.dirname(dir), `${path.basename(dir)}.rs`));
  return candidatos;
}

function declaradoBajoCfgTest(ruta: string): boolean {
  const dir = path.dirname(ruta);
  const cacheado = cache.get(dir);
  if (cacheado !== undefined) { return cacheado; }

  const nombre = path.basename(ruta, '.rs');
  const porNombre = new RegExp(
    `#\\[cfg\\(test\\)\\][\\s\\S]{0,${VENTANA_ATRIBUTOS}}?\\bmod\\s+${nombre}\\s*;`);
  const porRuta = new RegExp(
    `#\\[cfg\\(test\\)\\][\\s\\S]{0,${VENTANA_ATRIBUTOS}}?#\\[path\\s*=\\s*"[^"]*${nombre}\\.rs"\\]`);

  let resultado = false;
  for (const candidato of ficherosDeclarantes(dir)) {
    if (candidato.replace(/\\/g, '/') === ruta) { continue; }
    let contenido: string;
    try {
      contenido = fs.readFileSync(candidato, 'utf8');
    } catch {
      continue;
    }
    if (porNombre.test(contenido) || porRuta.test(contenido)) { resultado = true; break; }
  }

  cache.set(dir, resultado);
  return resultado;
}

export function esRutaDeTestRust(fileName: string): boolean {
  const ruta = fileName.replace(/\\/g, '/');
  if (ES_DIRECTORIO_DE_TEST.test(ruta)) { return true; }
  if (!ES_NOMBRE_DE_TEST.test(ruta)) { return false; }
  return declaradoBajoCfgTest(ruta);
}

/* Para los tests: la cache por directorio sobrevive entre casos y un mismo
 * directorio temporal reutilizado daria un veredicto viejo. */
export function olvidarCacheRutasTest(): void {
  cache.clear();
}

/* Calcula rangos de lineas que pertenecen a bloques de test.
 * Detecta #[cfg(test)] seguido de mod, y funciones #[test].
 * Retorna un Set de indices de linea que son "test code". */
export function calcularRangosTest(lineas: string[]): Set<number> {
  const rangos = new Set<number>();
  let dentroModTest = false;
  let profundidadLlaves = 0;
  let profundidadInicio = 0;

  for (let i = 0; i < lineas.length; i++) {
    const trimmed = lineas[i].trim();

    /* Detectar inicio de modulo test: #[cfg(test)] */
    if (trimmed === '#[cfg(test)]') {
      /* Marcar la linea del atributo y buscar el mod siguiente */
      rangos.add(i);
      dentroModTest = true;
      profundidadInicio = profundidadLlaves;
      continue;
    }

    if (dentroModTest) {
      rangos.add(i);

      /* Contar llaves para saber cuando termina el modulo */
      for (const ch of lineas[i]) {
        if (ch === '{') { profundidadLlaves++; }
        if (ch === '}') {
          profundidadLlaves--;
          if (profundidadLlaves <= profundidadInicio) {
            dentroModTest = false;
            break;
          }
        }
      }
    } else {
      /* Contar llaves globales para tracking correcto */
      for (const ch of lineas[i]) {
        if (ch === '{') { profundidadLlaves++; }
        if (ch === '}') { profundidadLlaves--; }
      }
    }
  }

  return rangos;
}
