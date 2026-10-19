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
