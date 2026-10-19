/* Enmascara el contenido de las cadenas de una línea para que las reglas solo vean código.
 * [por que] Un `!` dentro de un literal no es una non-null assertion: los archivos de test
 * llevan código de ejemplo en cadenas y las reglas los contaban como código real. Mantiene
 * la longitud de la línea. Por línea: una plantilla multilínea no se enmascara más allá de
 * su línea (queda como antes). */
export function enmascararLiterales(linea: string): string {
  let salida = '';
  let comilla: string | null = null;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comilla === null) {
      if (c === "'" || c === '"' || c === '`') { comilla = c; }
      salida += c;
    } else if (c === '\\') {
      /* Escape: el carácter siguiente no cierra la cadena. */
      salida += '  ';
      i++;
    } else if (c === comilla) {
      comilla = null;
      salida += c;
    } else {
      salida += ' ';
    }
  }
  return salida;
}
