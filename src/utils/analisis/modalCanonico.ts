import * as fs from 'fs';
import { recorrerFicherosSync } from '../recorrido';
/* Deteccion del Modal canonico del proyecto y de sus sufijos semanticos. Extraido de src/utils/analisisHelpers.ts (fachada). */

/* [119A-4 S4] Clases canonicas del sistema Modal que las reglas
 * modal-*-no-canonica presuponen. Si el proyecto no define ninguna, sugerir
 * "usa modalAcciones/modalTexto/..." es un falso positivo: no hay sistema. */
const CLASES_MODAL_CANONICAS_BUSQUEDA = /\.modal(?:Acciones|Formulario|Campo|Titulo|Texto)\b/;
const cacheModalCanonico = new Map<string, boolean>();

function contieneClaseModalCanonica(dir: string): boolean {
  return recorrerFicherosSync(dir, ruta => {
    if (!ruta.endsWith('.css')) { return false; }
    let texto: string;
    try {
      texto = fs.readFileSync(ruta, 'utf8');
    } catch {
      return false;
    }
    return CLASES_MODAL_CANONICAS_BUSQUEDA.test(texto);
  });
}

/*
 * [119A-4 S4] Retorna true si el proyecto define al menos una clase canonica
 * de Modal (.modalAcciones/.modalFormulario/.modalCampo/.modalTitulo/.modalTexto).
 * Fail-closed: sin roots configurados no se puede afirmar la ausencia, asi que
 * retorna true (las reglas siguen disparando como antes). Resultado con cache
 * por conjunto de roots; el recorrido para en el primer CSS con coincidencia.
 */
export function proyectoTieneModalCanonico(roots: string[]): boolean {
  const normalizados = roots.map(r => r.replace(/\\/g, '/').replace(/\/+$/, '')).filter(Boolean);
  if (normalizados.length === 0) { return true; }
  const clave = normalizados.join('|');
  const cached = cacheModalCanonico.get(clave);
  if (cached !== undefined) { return cached; }
  const tiene = normalizados.some(root => contieneClaseModalCanonica(root));
  cacheModalCanonico.set(clave, tiene);
  return tiene;
}

/* [15A-25] Solo se detectan los sufijos cuyo destino canonico EXISTE en el sistema:
 * .modalTitulo (barra compacta del <Modal>, modal.css) y .modalAcciones
 * (modalAcciones.css). `modalTexto` figuraba en la lista pero no esta definido en
 * ninguna hoja del proyecto, de modo que la regla prescribia una clase inexistente.
 * Un hallazgo cuyo remedio no es aplicable no es un hallazgo, es ruido.
 * Vive aqui, y no en la regla CSS, porque la regla de JSX necesita el mismo
 * veredicto sobre el mismo bloque (ver modal-acciones-no-canonico). */
export function sufijoSemanticoModal(nombreClase: string): 'Titulo' | 'Acciones' | null {
  if (nombreClase === 'modalTitulo' || nombreClase === 'modalAcciones') {
    return null;
  }

  const match = /(?:^modal[A-Z][\w-]*|^[A-Za-z][\w-]*Modal)(Titulo|Acciones)$/.exec(nombreClase);
  return (match?.[1] as 'Titulo' | 'Acciones' | undefined) ?? null;
}

export function claseCanonicaModal(sufijo: 'Titulo' | 'Acciones'): 'modalTitulo' | 'modalAcciones' {
  return sufijo === 'Titulo' ? 'modalTitulo' : 'modalAcciones';
}

/* [15A-25] La regla solo debe disparar cuando la clase local reescribe la receta
 * canonica y NO declara ademas un rol que esa receta no puede expresar. Los casos de
 * KAMPLES declaraban justamente eso, de modo que seguir la recomendacion habria
 * cambiado el render:
 * - .modalTitulo es la barra compacta de 13px, sin peso y alineada a la izquierda
 *   (modal.css:53-57). Un bloque que se centra, se pone en mayusculas o declara peso
 *   esta definiendo una cabecera de cuerpo.
 * - .modalAcciones es `display:flex; gap` y da flex:1 a sus hijos
 *   (modalAcciones.css:13-15). Un bloque que anade justify-content, flex-wrap,
 *   border-top, padding o un ancho esta maquetando un pie que la receta no
 *   contempla, y el flex:1 encogeria los botones. */
export function bloqueDefineSemanticaModal(cuerpo: string, sufijo: 'Titulo' | 'Acciones'): boolean {
  const cuerpoLimpio = cuerpo.replace(/\/\*[\s\S]*?\*\//g, ' ');

  if (sufijo === 'Acciones') {
    /* El guion cubre las familias `padding-top`, `margin-bottom`, `max-width`... */
    if (/(?:justify-content|flex-wrap|border-top|padding|margin|width|max-width|min-width|align-items|flex-direction|position)\s*[-:]/i.test(cuerpoLimpio)) {
      return false;
    }

    return /(display\s*:\s*flex|gap\s*:)/i.test(cuerpoLimpio);
  }

  if (/(?:text-align\s*:\s*center|text-transform)\s*:/i.test(cuerpoLimpio)) {
    return false;
  }

  if (/font-weight\s*:\s*(?:bold|[6-9]00|var\(--peso(?:Semi)?Bold\))/i.test(cuerpoLimpio)) {
    return false;
  }

  return /(font-size\s*:|font-family\s*:|font-weight\s*:|line-height\s*:|color\s*:|text-align\s*:|letter-spacing\s*:|margin(?:-top|-bottom)?\s*:)/i.test(cuerpoLimpio);
}
