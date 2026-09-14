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
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';

/*
 * Detecta titulos (<h1-h6>) dentro de bloques <Modal>.
 * Contrato: los modales son minimalistas — sin titulos, solo contenido y modalAcciones.
 * Gotcha: rastrea profundidad JSX de <Modal> para no fallar en h* fuera del modal.
 */
export function verificarModalConTitulo(lineas: string[]): Violacion[] {
  const texto = lineas.join('\n');
  if (texto.includes('sentinel-disable-file modal-con-titulo')) { return []; }

  const violaciones: Violacion[] = [];
  let profundidadModal = 0;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'modal-con-titulo')) { continue; }

    /* Apertura de Modal (no self-closing) */
    if (/<Modal[\s>]/.test(linea) && !/<Modal[^>]*\/>/.test(linea)) {
      profundidadModal++;
    }
    /* Cierre de Modal */
    if (/<\/Modal>/.test(linea)) {
      profundidadModal = Math.max(0, profundidadModal - 1);
    }

    if (profundidadModal > 0 && /<h[1-6][\s/>]/.test(linea)) {
      const numH = linea.match(/<h([1-6])/)?.[1] ?? '?';
      violaciones.push({
        reglaId: 'modal-con-titulo',
        mensaje: `<h${numH}> detectado dentro de <Modal>. Los modales no llevan titulo — contenido directo + modalAcciones solamente.`,
        severidad: obtenerSeveridadRegla('modal-con-titulo'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Detecta clases tipo "*Acciones" no canonicas dentro de bloques <Modal>.
 * Contrato: el unico contenedor de botones valido en un modal es className="modalAcciones".
 * Gotcha: excluye clases que no terminan en "Acciones" para evitar falsos positivos.
 */
export function verificarModalAccionesNoCanonico(lineas: string[]): Violacion[] {
  const texto = lineas.join('\n');
  if (texto.includes('sentinel-disable-file modal-acciones-no-canonico')) { return []; }

  const violaciones: Violacion[] = [];
  let profundidadModal = 0;

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
        const clases = classMatch[1].split(/\s+/);
        const accionesNoCanonica = clases.find(c => c.endsWith('Acciones') && c !== 'modalAcciones');
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
): Violacion[] {
  const texto = lineas.join('\n');
  if (texto.includes('sentinel-disable-file modal-estructura-no-canonica')) { return []; }
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
      const claseContenedorLocal = (esLineaModal && clases.length > 0 && !tieneClaseCanonica)
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
          mensaje: `Clase "${claseFormularioLocal}" redefine el cuerpo/formulario compartido del modal. Usa className="modalFormulario" o <ModalBody ...>.`,
          severidad: obtenerSeveridadRegla('modal-estructura-no-canonica'),
          linea: i,
          fuente: 'estatico',
        });
      }

      if (enContextoModal && /<(?:div|label|fieldset)[\s>]/.test(linea) && claseCampoLocal && !usaCampoCanonico) {
        violaciones.push({
          reglaId: 'modal-estructura-no-canonica',
          mensaje: `Clase "${claseCampoLocal}" redefine un campo compartido de Modal. Usa className="modalCampo" o <ModalField>.`,
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
