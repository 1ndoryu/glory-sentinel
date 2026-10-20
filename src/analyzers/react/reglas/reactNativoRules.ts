/*
 * Reglas de elementos nativos y botones: HTML nativo en vez de componente del
 * sistema y clases de boton especificas. Los wrappers de components/ui quedan
 * fuera porque construyen el elemento nativo a proposito.
 */

import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { componenteExentoPorProyecto } from '../../../config/exencionesProyecto';
import { esComentario, tieneSentinelDisable, tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { existeComponenteUi } from './reactUiCatalog';

/* [08AA-26] components/ui es el sistema de diseno: sus wrappers construyen el elemento
 * nativo a proposito (ui/textarea.tsx envuelve <textarea>). La regla vigila el uso en la
 * app, no la definicion del componente base. Recibe la ruta completa: la regla solo ve el basename. */
export function esWrapperSistemaDiseno(ruta: string): boolean {
  return /[\\/]components[\\/]ui[\\/]/.test(ruta);
}

/* [11AA-1] Mira el tag de apertura (ventana de 6 lineas, como el <input> de abajo)
 * buscando aria-expanded. */
export function esDisparadorDisclosure(lineas: string[], i: number): boolean {
  return /\baria-expanded\s*=/.test(lineas.slice(i, Math.min(i + 6, lineas.length)).join(' '));
}

/*
 * Detecta uso de elementos HTML nativos que deberian ser componentes propios
 * del proyecto (Boton, Input, Select, Textarea, Checkbox, Radio, GloryLink).
 *
 * Excluye: archivos que SON los propios componentes UI, tests,
 * wrappers (Campo*, Toggle*, Switch*), Glory framework.
 */
export function verificarHtmlNativoEnVezDeComponente(lineas: string[], nombreArchivo: string): Violacion[] {
  /* Componentes propios del proyecto (Boton, Input...) que renderizan HTML nativo a propósito.
   * Los del framework Glory (GloryLink, PageRenderer...) salen del perfil `glory`. */
  const archivosExcluidos = [
    'Boton', 'BotonBase', 'Button', 'Input', 'Select', 'SelectorMenu', 'SelectorBase', 'SelectorPersonalizado',
    'Textarea', 'CampoTexto', 'Checkbox', 'Radio',
  ];
  const nombreBase = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  if (archivosExcluidos.includes(nombreBase) || componenteExentoPorProyecto(nombreBase)) { return []; }

  const prefijosWrapper = ['Campo', 'Toggle', 'Switch'];
  if (prefijosWrapper.some(p => nombreBase.startsWith(p))) { return []; }

  if (nombreArchivo.includes('.test.') || nombreArchivo.includes('.spec.') ||
      nombreArchivo.includes('_generated')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  /* [104A-4] Soporte sentinel-disable-file para esta regla.
   * [259A-5] Match por token exacto via helper central. */
  const texto = lineas.join('\n');
  if (tieneSentinelDisableFile(texto, 'html-nativo-en-vez-de-componente')) { return []; }

  const tieneBotonUi = existeComponenteUi(['Button', 'Boton', 'BotonBase']);
  const tieneInputUi = existeComponenteUi(['Input', 'CampoTexto']);
  const tieneTextareaUi = existeComponenteUi(['Textarea']);
  const tieneGloryLinkUi = existeComponenteUi(['GloryLink']);
  /* [318A-3] El aviso de <Select> deprecado solo aplica donde existe SelectDropdown
   * (rule 205A-2); en proyectos con Select propio y sin SelectDropdown era FP puro. */
  const tieneSelectDropdownUi = existeComponenteUi(['SelectDropdown']);

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'html-nativo-en-vez-de-componente')) { continue; }
    /* Tambien skip inline sentinel-disable */
    if (linea.includes('sentinel-disable html-nativo-en-vez-de-componente')) { continue; }

    /* [11AA-1] Un <button> con aria-expanded es disparador de disclosure (fila plegable
     * con layout propio): el patron nativo es el correcto y el Boton del DS no encaja
     * sin cambiar el layout. Limite: el atributo basta, no se verifica el contenido. */
    if (tieneBotonUi && /<button[\s>]/.test(linea) && !esDisparadorDisclosure(lineas, i)) {
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar componente <Boton> en vez de <button> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    if (tieneInputUi && /<input[\s/]/.test(linea)) {
      /* type="hidden" es un patron comun de formularios; type="file" es un trigger nativo con ref.
       * [054A-19] Buscar type en la misma linea o en las siguientes (JSX multi-linea) */
      const fragmento = lineas.slice(i, Math.min(i + 6, lineas.length)).join(' ');
      if (/type\s*=\s*["'](?:hidden|file)["']/i.test(fragmento)) { continue; }
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar componente <Input> (o <Checkbox>/<Radio> segun type) en vez de <input> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    /* [105A-30] Los selects nativos quedan prohibidos aunque el selector custom
     * del proyecto no se llame literalmente Select. */
    if (/<select[\s>]/.test(linea)) {
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar selector personalizado del sistema en vez de <select> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    /* [205A-2] <Select> del sistema queda deprecated — usar SelectDropdown (usa MenuContextual).
     * [318A-3] Solo cuando SelectDropdown existe (si no, el Select del proyecto es canónico). */
    if (tieneSelectDropdownUi && /<Select[\s/]/.test(linea)) {
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar <SelectDropdown> de components/ui/SelectDropdown en vez de <Select> genérico. SelectDropdown usa MenuContextual para consistencia visual.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    if (tieneTextareaUi && /<textarea[\s>]/.test(linea)) {
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar componente <Textarea> en vez de <textarea> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    if (tieneGloryLinkUi && /<a\s+(?:[^>]*\s)?href\s*=/i.test(linea)) {
      if (/\bdownload\b/i.test(linea)) { continue; }
      if (/href\s*=\s*["']#/i.test(linea)) { continue; }
      if (/href\s*=\s*\{/.test(linea)) { continue; }
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar <GloryLink> en vez de <a href> para navegacion SPA interna. Import desde core/router.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

const CLASES_BOTON_SISTEMA = new Set([
  'botonBase', 'botonPrimario', 'botonSecundario', 'botonOutline', 'botonTexto',
  'botonExito', 'botonExitoSuave', 'botonPeligro', 'botonPeligroSuave',
  'botonAdvertencia', 'botonAdvertenciaSuave', 'botonInfo', 'botonInfoSuave',
  'botonPequeno', 'botonMediano', 'botonGrande',
  /* [317A-3] Receta .boton-icono (solo icono) y variantes kebab reales del proyecto. */
  'boton-pequeno', 'boton-mediano', 'boton-grande', 'boton-icono',
  'botonIcono',
]);

function esClaseBotonEspecifica(nombreClase: string): boolean {
  if (!nombreClase || CLASES_BOTON_SISTEMA.has(nombreClase)) {
    return false;
  }

  return /(?:boton|button)[A-Z]/i.test(nombreClase)
    || /(?:^|[-_])(?:boton|button)(?:[-_][\w-]+)+$/i.test(nombreClase);
}

/*
 * Detecta className especifico aplicado a botones/componentes Button.
 * Estos estilos suelen duplicar variantes del sistema y degradan consistencia visual.
 */
export function verificarButtonClaseEspecifica(lineas: string[], nombreArchivo: string): Violacion[] {
  const nombreBase = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  if (['Boton', 'BotonBase', 'Button'].includes(nombreBase)) { return []; }

  if (nombreArchivo.includes('.test.') || nombreArchivo.includes('.spec.') ||
      nombreArchivo.includes('_generated')) {
    return [];
  }

  const texto = lineas.join('\n');
  if (tieneSentinelDisableFile(texto, 'button-clase-especifica')) { return []; }

  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'button-clase-especifica')) { continue; }
    if (linea.includes('sentinel-disable button-clase-especifica')) { continue; }
    if (!/<(?:Button|Boton|button)\b/.test(linea)) { continue; }

    const fragmento = lineas.slice(i, Math.min(i + 6, lineas.length)).join(' ');
    const classMatch = /className\s*=\s*(?:\{\s*`([^`]+)`\s*\}|`([^`]+)`|["']([^"']+)["'])/.exec(fragmento);
    if (!classMatch) { continue; }

    const rawClassName = classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? '';
    const claseProblematica = rawClassName
      .split(/\s+/)
      .find(esClaseBotonEspecifica);

    if (!claseProblematica) { continue; }

    violaciones.push({
      reglaId: 'button-clase-especifica',
      mensaje: `Clase especifica de boton "${claseProblematica}" detectada. Preferir variantes/tamanos de <Button> y mover la semantica a contenedores o contenido interno.`,
      severidad: obtenerSeveridadRegla('button-clase-especifica'),
      linea: i,
      fuente: 'estatico',
    });
  }

  return violaciones;
}
