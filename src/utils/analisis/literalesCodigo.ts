/* Enmascara el contenido de las cadenas de una línea para que las reglas solo vean código.
 * [por que] Un `!` dentro de un literal no es una non-null assertion: los archivos de test
 * llevan código de ejemplo en cadenas y las reglas los contaban como código real. Mantiene
 * la longitud de la línea. Por línea: una plantilla multilínea no se enmascara más allá de
 * su línea (queda como antes). Un `//` fuera de cadena abre un comentario: el resto de la
 * línea queda visible, para que un apóstrofo dentro de un comentario no oculte un marcador. */
export function enmascararLiterales(linea: string): string {
  return enmascarar(linea, true);
}

/* Solo '...' y "...": las plantillas `...` quedan visibles. [por que] Las reglas que buscan
 * HTML en plantillas necesitan ver el contenido de los backticks; sus fixtures van dentro
 * de cadenas '...' o "...", que sí se enmascaran. Un backtick abre un tramo de plantilla
 * en el que los apóstrofos no abren cadena. */
export function enmascararLiteralesSimples(linea: string): string {
  return enmascarar(linea, false);
}

function enmascarar(linea: string, conPlantillas: boolean): string {
  let salida = '';
  let comilla: string | null = null;
  let enPlantilla = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comilla === null) {
      if (c === '/' && linea[i + 1] === '/') { return salida + linea.slice(i); }
      if (c === '`' && !conPlantillas) { enPlantilla = !enPlantilla; }
      else if (!enPlantilla && (c === "'" || c === '"' || (conPlantillas && c === '`'))) { comilla = c; }
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
