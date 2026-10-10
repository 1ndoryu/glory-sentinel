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
