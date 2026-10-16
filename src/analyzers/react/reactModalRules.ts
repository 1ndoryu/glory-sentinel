/*
 * Reglas de arquitectura de modales React (extraido de reactComponentRules.ts).
 *
 * [149A-1 0.7.12] Split mecanico por budget ADR 0001 (reactComponentRules.ts
 * supero 950 lineas por crecimiento in-base 119A-4): movimiento puro, cero
 * cambio de comportamiento. reactComponentRules.ts re-exporta estos simbolos
 * para no tocar ningun importador (reactAnalyzer, tests).
 */

import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import {
  bloqueDefineSemanticaModal,
  esComentario,
  indiceProyecto,
  tieneSentinelDisable,
  tieneSentinelDisableFile,
} from '../../utils/analisisHelpers';

/*
 * Detecta titulos (<h1-h6>) que son hijos directos de un bloque <Modal>.
 * Contrato: los modales son minimalistas — contenido directo y modalAcciones.
 *
 * [15A-25] Antes disparaba a CUALQUIER profundidad dentro del <Modal>, lo que
 * contradecia su propio mensaje («contenido directo») y su propia premisa: el
 * <Modal> canonico SI pinta titulo cuando recibe la prop `titulo`
 * (Modal.tsx:92-94, <h2 className="modalTitulo"> a 13px). Los ocho casos de
 * KAMPLES eran encabezados propios de modales que necesitan una cabecera mas
 * rica que esa barra compacta (icono + titulo en linea, titulo centrado de
 * 18px, rotulo de seccion de 12px en mayusculas) y NINGUNO era hijo directo.
 *
 * Criterio: la primera etiqueta JSX que aparece despues de cerrar `<Modal ...>`
 * tiene que ser el propio encabezado. Es conservador a proposito — si antes hay
 * otro elemento, no dispara — y solo mira modales cuya etiqueta de apertura se
 * cierra en su propia linea, para no tener que interpretar atributos con JSX
 * (`icono={<X />}`) ni etiquetas partidas en varias lineas.
 */
export function verificarModalConTitulo(lineas: string[]): Violacion[] {
  const texto = lineas.join('\n');
  if (tieneSentinelDisableFile(texto, 'modal-con-titulo')) { return []; }

  const violaciones: Violacion[] = [];
  const ETIQUETA_JSX = /<([A-Za-z][\w.$-]*)/;

  function registrar(lineaHijo: number, etiqueta: string): void {
    if (!/^h[1-6]$/.test(etiqueta)) { return; }
    if (tieneSentinelDisable(lineas, lineaHijo, 'modal-con-titulo')) { return; }
    violaciones.push({
      reglaId: 'modal-con-titulo',
      mensaje: `<${etiqueta}> como hijo directo de <Modal>. Los modales no llevan titulo — usa la prop \`titulo\` del <Modal> o deja el encabezado dentro de su propia cabecera.`,
      severidad: obtenerSeveridadRegla('modal-con-titulo'),
      linea: lineaHijo,
      fuente: 'estatico',
    });
  }

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }
    if (!/<Modal[\s>]/.test(linea) || /<Modal[^>]*\/>/.test(linea)) { continue; }
    /* La etiqueta de apertura debe cerrarse en esta misma linea. */
    if (!/\/?>\s*$/.test(linea)) { continue; }

    /* Resto de la linea tras la etiqueta de apertura. */
    const resto = linea.replace(/^[\s\S]*?\/?>/, '');
    const enMismaLinea = ETIQUETA_JSX.exec(resto);
    if (enMismaLinea) {
      registrar(i, enMismaLinea[1]);
      continue;
    }

    for (let j = i + 1; j < lineas.length; j++) {
      if (/<\/Modal>/.test(lineas[j])) { break; }
      if (esComentario(lineas[j])) { continue; }
      const primera = ETIQUETA_JSX.exec(lineas[j]);
      if (!primera) { continue; }
      registrar(j, primera[1]);
      break;
    }
  }

  return violaciones;
}

/*
 * Detecta clases tipo "*Acciones" no canonicas dentro de bloques <Modal>.
 * Contrato: el unico contenedor de botones valido en un modal es className="modalAcciones".
 *
 * [15A-25] El nombre no basta: `XAcciones` solo reescribe la receta cuando su hoja
 * define de verdad una zona de acciones. Las cuatro clases de KAMPLES que disparaban
 * no lo hacian — .configAcciones y .generosAcciones son pies con borde propio y
 * reparto a los extremos, .modalCodigoExpiradoAcciones anade flex-end + flex-wrap — y
 * seguir la recomendacion habria metido el flex:1 de .modalAcciones, encogiendo los
 * botones. El veredicto sale del bloque CSS, con el mismo predicado que usa la regla
 * de CSS (utils/analisisHelpers). Solo .algoTimingAcciones, duplicado literal de
 * .modalAcciones (`display:flex; gap`), queda como hallazgo.
 */
export function verificarModalAccionesNoCanonico(lineas: string[], roots: string[] = []): Violacion[] {
  const texto = lineas.join('\n');
  if (tieneSentinelDisableFile(texto, 'modal-acciones-no-canonico')) { return []; }

  const { cuerposCss } = indiceProyecto(roots);
  const violaciones: Violacion[] = [];
  let profundidadModal = 0;

  /* Reescribe la receta si alguno de sus bloques ES una zona de acciones. Sin
   * bloque CSS no hay receta que juzgar y se mantiene el veredicto por nombre
   * (fail-closed, igual que cuando no hay roots configurados). */
  function reescribeRecetaAcciones(clase: string): boolean {
    const cuerpos = cuerposCss.get(clase) ?? [];
    return cuerpos.length === 0 || cuerpos.some(cuerpo => bloqueDefineSemanticaModal(cuerpo, 'Acciones'));
  }

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'modal-acciones-no-canonico')) { continue; }

    if (/<Modal[\s>]/.test(linea) && !/<Modal[^>]*\/>/.test(linea)) {
      profundidadModal++;
    }
    if (/<\/Modal>/.test(linea)) {
      profundidadModal = Math.max(0, profundidadModal - 1);
    }

    if (profundidadModal > 0) {
      const classMatch = /className\s*=\s*["']([^"']+)["']/.exec(linea);
      if (classMatch) {
        const clases = classMatch[1].split(/\s+/).filter(Boolean);
        /* Si la zona canonica ya esta, lo demas es un modificador suyo. */
        if (clases.includes('modalAcciones')) { continue; }

        const accionesNoCanonica = clases.find(c => c.endsWith('Acciones') && reescribeRecetaAcciones(c));
        if (accionesNoCanonica) {
          violaciones.push({
            reglaId: 'modal-acciones-no-canonico',
            mensaje: `Clase "${accionesNoCanonica}" dentro de <Modal> no es canonical. Usar className="modalAcciones" para la zona de botones.`,
            severidad: obtenerSeveridadRegla('modal-acciones-no-canonico'),
            linea: i,
            fuente: 'estatico',
          });
        }
      }
    }
  }

  return violaciones;
}

function archivoPareceModal(nombreArchivo: string): boolean {
  return /(?:^Modal[A-Z].*|.*Modal)\.(?:tsx|jsx)$/.test(nombreArchivo);
}

function extraerClasesEstaticas(linea: string): string[] {
  const match = /className\s*=\s*(?:["']([^"']+)["']|\{\s*`([^`]+)`\s*\})/.exec(linea);
  const raw = match?.[1] ?? match?.[2];

  if (!raw) {
    return [];
  }

  return raw
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token && !token.includes('${'));
}

/* [Sentinel] Clases canónicas para el contenedor de <Modal>.
 * modalSinPadding = sin padding interno.
 * modalCompacto/modalMedio/modalGrande = variantes de ancho estándar.
 * Si UNA clase canónica está presente la regla no dispara — la className del
 * componente puede incluir también clases locales para estilos no-contenedor. */
const CLASES_CONTENEDOR_MODAL_CANONICAS = new Set([
  'modalSinPadding',
  'modalCompacto',
  'modalMedio',
  'modalGrande',
]);

/* [035A-24] Detecta contenedor/formulario/campos locales que reescriben la receta compartida del modal.
 * Casos como .usuariosModal, .hostingFormCrear o .usuariosCrearCampo deben migrar
 * al sistema compartido de Modal en vez de redefinir estructura en cada componente. */
export function verificarModalEstructuraNoCanonica(
  lineas: string[],
  nombreArchivo: string,
  /* [119A-4 S4] El caller (reactAnalyzer) lo calcula con proyectoTieneModalCanonico().
   * Default true = fail-closed: sin evidencia de ausencia, la regla dispara como antes. */
  tieneModalCanonico = true,
  /* [15A-25] El caller lo calcula con indiceProyecto().modalFusionaClassName. Un
   * <Modal className="X"> no reescribe el contenedor: lo APPENDEA.
   * Default false = fail-closed, la regla dispara como antes. */
  modalFusionaClassName = false,
): Violacion[] {
  const texto = lineas.join('\n');
  if (tieneSentinelDisableFile(texto, 'modal-estructura-no-canonica')) { return []; }
  if (!tieneModalCanonico) { return []; }

  const violaciones: Violacion[] = [];
  const archivoModal = archivoPareceModal(nombreArchivo);
  let profundidadModal = 0;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'modal-estructura-no-canonica')) { continue; }

    const esLineaModal = /<Modal[\s>]/.test(linea);

    if (esLineaModal && !/<Modal[^>]*\/>/.test(linea)) {
      profundidadModal++;
    }

    const enContextoModal = archivoModal || profundidadModal > 0;
    const clases = extraerClasesEstaticas(linea);

    if (clases.length > 0) {
      const tieneClaseCanonica = clases.some(clase => CLASES_CONTENEDOR_MODAL_CANONICAS.has(clase));
      /* [15A-25] La prop `className` de <Modal> no sustituye al contenedor: Modal.tsx
       * la concatena (`const clasesContenedor = ['modalContenedor', mapaTamano[tamano],
       * className]`). Con esa evidencia la clase local es una variante, no una
       * redefinicion, y el aviso era falso para los cuatro casos de KAMPLES. */
      const claseContenedorLocal = (esLineaModal && !tieneClaseCanonica && !modalFusionaClassName)
        ? clases[0]
        : undefined;
      const usaFormularioCanonico = clases.includes('modalFormulario');
      const usaCampoCanonico = clases.includes('modalCampo');
      const claseFormularioLocal = clases.find(clase => /(?:Formulario|FormCrear)$/.test(clase));
      const claseCampoLocal = clases.find(clase => /Campo$/.test(clase) && clase !== 'modalCampo');

      if (claseContenedorLocal) {
        violaciones.push({
          reglaId: 'modal-estructura-no-canonica',
          mensaje: `Clase "${claseContenedorLocal}" redefine el contenedor compartido de <Modal>. Usa el contenedor base y, si hace falta una variante, agrégala al sistema UI en vez de una className local.`,
          severidad: obtenerSeveridadRegla('modal-estructura-no-canonica'),
          linea: i,
          fuente: 'estatico',
        });
      }

      /* [095A-6] Bug corregido: la condicion original incluia "|| Boolean(claseFormularioLocal)"
       * que disparaba la regla FUERA de contexto Modal para cualquier clase terminada en
       * "Formulario" (ej: contactoFormulario en la pagina de contacto). La regla solo
       * debe disparar dentro de un <Modal> real. */
      if (enContextoModal && /<(?:form|div)[\s>]/.test(linea) && claseFormularioLocal && !usaFormularioCanonico) {
        violaciones.push({
          reglaId: 'modal-estructura-no-canonica',
          mensaje: `Clase "${claseFormularioLocal}" redefine el cuerpo/formulario compartido del modal. Usa className="modalFormulario".`,
          severidad: obtenerSeveridadRegla('modal-estructura-no-canonica'),
          linea: i,
          fuente: 'estatico',
        });
      }

      if (enContextoModal && /<(?:div|label|fieldset)[\s>]/.test(linea) && claseCampoLocal && !usaCampoCanonico) {
        violaciones.push({
          reglaId: 'modal-estructura-no-canonica',
          mensaje: `Clase "${claseCampoLocal}" redefine un campo compartido de Modal. Usa className="modalCampo".`,
          severidad: obtenerSeveridadRegla('modal-estructura-no-canonica'),
          linea: i,
          fuente: 'estatico',
        });
      }
    }

    if (/<\/Modal>/.test(linea)) {
      profundidadModal = Math.max(0, profundidadModal - 1);
    }
  }

  return violaciones;
}
