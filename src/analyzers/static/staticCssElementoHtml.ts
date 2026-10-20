/* Reglas CSS de selectores sobre elementos HTML nativos dentro de clases de componente. Extraido de staticCssRules.ts. */
import { Violacion } from '../../types';
import { CoreTextDocument } from '../../core/runtime-proyecto/types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { rutaExentaPorProyecto } from '../../config/exencionesProyecto';
import {
  tieneSentinelDisable,
  tieneSentinelDisableFile,
} from '../../utils/analisisHelpers';

/*
 * Detecta selectores CSS que apuntan directamente a elementos HTML nativos
 * (button, h1-h6) dentro de una clase de componente.
 *
 * Patron problemático: .{componenteEspecifico} button { ... }
 *                      .{componenteEspecifico} h3 { ... }
 *
 * El correcto es dar className al componente React:
 *   - Para botones: usar className="..." en <Button>, no selector raw.
 *   - Para titulos en modales/panel: usar className="modalTitulo" en JSX.
 *
 * Excepciones válidas (no se reportan):
 *   - .tiptap h* (contenido renderizado del editor rico)
 *   - .{algo}Texto h* (contenido HTML de artículos, blog)
 *   - .{algo}Vacio h* (estados vacíos con h neutral)
 *   - init.css, Button.css, Modal.css, variables.css (base del sistema)
 */
export function verificarCssElementoHTMLDirecto(
  texto: string,
  documento: CoreTextDocument,
  nombreArchivo: string,
): Violacion[] {
  const nombreLower = nombreArchivo.toLowerCase();
  if (/^(button|init|variables|modal|reset)\.css$/.test(nombreLower)) {
    return [];
  }

  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  if (rutaNorm.includes('/node_modules/') || rutaNorm.includes('/vendor/') || rutaExentaPorProyecto(rutaNorm)) {
    return [];
  }

  if (tieneSentinelDisableFile(texto, 'css-elemento-html-directo')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  /* Selector: .{class} button { o .{class} h1-h6 { */
  const regexElementoHTML = /^\s*\.[\w-]+\s+(button|h[1-6])\s*[{,]/;

  /* Excepciones: contextos donde estilar h* directamente es válido */
  const excepcionH = /\.(tiptap|[a-zA-Z]+Texto|[a-zA-Z]+Vacio|[a-zA-Z]+Single)\s+h[1-6]/;

  /* [15A-25] Una superficie de contenido inyectado (markdown, rich text, un
   * contentEditable) no admite className en sus h2/h3: el marcado lo genera un
   * renderizador, no el JSX del componente. Se reconoce por su FORMA, no por su
   * nombre: si una misma clase estiliza tres o mas elementos crudos distintos en la
   * hoja, es una superficie de contenido y no el marcado propio de un componente.
   * Los nueve hallazgos de KAMPLES eran `.prose` (12 elementos), `.prose-sm`,
   * `.editorArticuloContenido` (4) y `.articuloDetalleContenido` (10); la lista
   * anterior (tiptap|*Texto|*Vacio|*Single) solo acertaba por casualidad del nombre,
   * y de hecho ya eximia a `.tiptap` — que es la misma cosa. */
  const MIN_ELEMENTOS_SUPERFICIE = 3;
  const elementosPorClase = new Map<string, Set<string>>();
  const regexClaseElemento = /\.([\w-]+)\s+(button|h[1-6]|p|ul|ol|li|a|img|blockquote|code|pre|table|hr|strong|em)\b/g;
  let coincidencia: RegExpExecArray | null;

  while ((coincidencia = regexClaseElemento.exec(texto)) !== null) {
    const elementos = elementosPorClase.get(coincidencia[1]) ?? new Set<string>();
    elementos.add(coincidencia[2]);
    elementosPorClase.set(coincidencia[1], elementos);
  }

  function esSuperficieDeContenido(linea: string): boolean {
    for (const clase of Array.from(linea.matchAll(/\.([\w-]+)/g), grupo => grupo[1])) {
      const elementos = elementosPorClase.get(clase);
      if (elementos && elementos.size >= MIN_ELEMENTOS_SUPERFICIE) { return true; }
    }

    return false;
  }

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) { continue; }
    if (tieneSentinelDisable(lineas, i, 'css-elemento-html-directo')) { continue; }

    const match = regexElementoHTML.exec(linea);
    if (!match) { continue; }

    const elemento = match[1];
    if (elemento !== 'button' && excepcionH.test(linea)) { continue; }
    if (esSuperficieDeContenido(linea)) { continue; }

    const mensaje = elemento === 'button'
      ? `Selector ".{clase} button" detectado. Pasar className al <Button> en lugar de apuntar al elemento raw.`
      : `Selector ".{clase} ${elemento}" detectado. Usar className="modalTitulo" en JSX en lugar de estilar por selector de elemento.`;

    violaciones.push({
      reglaId: 'css-elemento-html-directo',
      mensaje,
      severidad: obtenerSeveridadRegla('css-elemento-html-directo'),
      linea: i,
      fuente: 'estatico',
    });
  }

  return violaciones;
}
