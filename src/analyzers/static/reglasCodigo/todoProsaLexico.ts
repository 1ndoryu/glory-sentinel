/*
 * Léxico de la regla todo-prosa-sin-marcador: palabras que distinguen el "todo" cuantificador del marcador informal. Extraido de todoProsa.ts.
 */

export const PATRON_TODO_PROSA = /\btodo\b/gi;
export const ARTICULOS_PROSA = new Set(['el', 'la', 'los', 'las', 'lo']);
/* "todo y/o …" o "todo queda/va/es …" en minusculas es el cuantificador
 * ("se descarta todo y va el minimo", "todo queda false"); TODO en
 * mayusculas sigue siendo taquigrafia de tarea. */
export const PALABRAS_CUANTIFICADOR = new Set([
  'y', 'o',
  'queda', 'quedan', 'va', 'van', 'es', 'son', 'sigue', 'siguen', 'falla', 'fallan', 'hay',
]);
/* [17AA-4] En minusculas, "todo" es el marcador informal solo si le sigue un
 * verbo en infinitivo: "todo revisar el adapter" es una tarea, "todo verde = 0"
 * o "todo pendiente" es el cuantificador espanol. Las guardas de articulo y de
 * verbo cuantificador de arriba eran listas cerradas y por eso se colaba
 * `scripts/dev/doctor.mjs:1630` ("* todo verde = 0; ..."). La terminacion sola
 * basta: `ir`, `ser` y `ver` tambien son infinitivos. */
export function esInfinitivo(palabra: string): boolean {
  return palabra.length >= 2 && /(ar|er|ir)$/.test(palabra);
}
/* El infinitivo puede ir detras de una preposicion: "todo sin marcar", "todo
 * por revisar". Sin esto se perderian marcadores informales legitimos. */
export const PREPOSICIONES_PROSA = new Set(['a', 'de', 'en', 'con', 'sin', 'por', 'para']);

