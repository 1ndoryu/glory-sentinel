/*
 * [T5] Límites comunes para las llamadas a git de Sentinel. Un repositorio grande
 * o un git colgado no deben bloquear el análisis ni llenar la memoria: al pasar el
 * timeout o el buffer, la llamada falla y quien la invoca decide (fallback o error).
 */

/* Tope de cada invocación de git (2 min: holgado para merges y worktrees normales). */
export const GIT_TIMEOUT_MS = 120_000;

/* Salida máxima de una invocación. `ls-files --others --ignored` en un repo con
 * node_modules puede pasar de 4 MiB; 64 MiB sigue acotado. */
export const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/* Listas rápidas de archivos (cambios del alcance del gate): deben responder en
 * segundos; si no, el alcance cae a un fallback explícito en vez de bloquear. */
export const GIT_LISTA_TIMEOUT_MS = 20_000;

/* Una lista de archivos cambiados cabe de sobra en 8 MiB; si no cabe, el fallo es
 * explícito y no se consume memoria sin límite. */
export const GIT_LISTA_MAX_BUFFER = 8 * 1024 * 1024;
