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
