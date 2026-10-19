/*
 * Conjunto de solo lectura para constantes de módulo.
 * Exportar un Set mutable deja que cualquier importador lo modifique en
 * tiempo de ejecución (singleton-mutable-state). Devolver ReadonlySet
 * conserva el mismo uso (.has) y lo impide en compilación.
 */

export function conjuntoConstante<T>(valores: readonly T[]): ReadonlySet<T> {
  return new Set(valores);
}
