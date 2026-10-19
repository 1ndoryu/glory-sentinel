import { rename, writeFile } from 'node:fs/promises';

/* [028A-6 Fase 1] Escritura atómica compartida del core. El orquestador la
 * inlinaba en scope.mjs y reporter.mjs; al extraer más módulos (cache,
 * scheduler) pasa a ser una utilidad única para que el JSON publicado nunca
 * quede a medias. */
export async function writeAtomic(target: string, content: string): Promise<void> {
  const temporary = `${target}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
}
