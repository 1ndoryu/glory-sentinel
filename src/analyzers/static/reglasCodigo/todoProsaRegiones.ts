/*
 * Localiza las regiones de comentario donde se busca "todo" en prosa. Extraido de todoProsa.ts.
 */

export function extraerRegionesComentarioTodoProsa(texto: string): Array<{ inicio: number; fin: number }> {
  const regiones: Array<{ inicio: number; fin: number }> = [];
  let i = 0;
  let literal: string | null = null;

  while (i < texto.length) {
    const actual = texto[i];
    const siguiente = i + 1 < texto.length ? texto[i + 1] : '';

    if (literal !== null) {
      if (actual === '\\') {
        i += 2;
        continue;
      }
      if (actual === literal) {
        literal = null;
      }
      i++;
      continue;
    }

    if (actual === "'" || actual === '"' || actual === '`') {
      literal = actual;
      i++;
      continue;
    }

    if (actual === '/' && siguiente === '/') {
      let fin = texto.indexOf('\n', i + 2);
      if (fin === -1) {
        fin = texto.length;
      }
      regiones.push({ inicio: i + 2, fin });
      i = fin;
      continue;
    }

    if (actual === '/' && siguiente === '*') {
      const cierre = texto.indexOf('*/', i + 2);
      const fin = cierre === -1 ? texto.length : cierre;
      regiones.push({ inicio: i + 2, fin });
      i = cierre === -1 ? texto.length : cierre + 2;
      continue;
    }

    i++;
  }

  return regiones;
}
