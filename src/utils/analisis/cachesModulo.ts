/* [M-S8] Cachés de módulo que dependen del contenido del workspace. El LSP es de
 * larga vida: sin vaciarlas, un CSS o un Cargo.toml editado seguiría dando el
 * veredicto viejo. Cada caché se registra aquí y se vacía toda junta al recargar. */
const cachesRegistradas: Array<{ clear(): void }> = [];

/* Registra la caché y la devuelve, para declararla en la misma línea. */
export function registrarCacheModulo<T extends { clear(): void }>(cache: T): T {
  cachesRegistradas.push(cache);
  return cache;
}

/* Vacía todas las cachés registradas: la siguiente consulta recalcula desde disco. */
export function invalidarCachesModulo(): void {
  for (const cache of cachesRegistradas) { cache.clear(); }
}
