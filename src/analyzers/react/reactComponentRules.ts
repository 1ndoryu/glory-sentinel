/*
 * Reglas de arquitectura de componentes React.
 * Detecta: mutacion directa de estado, key-index en listas,
 * componente sin hook dedicado, HTML nativo en vez de componente,
 * clases especificas en botones, componente artesanal,
 * update optimista sin rollback.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';

const cacheComponentesUi = new Map<string, boolean>();
let workspaceRootsReact: string[] = [];

export function configurarWorkspaceRootsReact(roots: string[]): void {
  const normalizadas = roots.map(root => root.replace(/\\/g, '/'));
  if (normalizadas.join('|') === workspaceRootsReact.join('|')) {
    return;
  }

  workspaceRootsReact = normalizadas;
  cacheComponentesUi.clear();
}

/* [119A-4 S4] Expone las roots para que reactAnalyzer calcule
 * proyectoTieneModalCanonico() una vez por archivo. */
export function obtenerWorkspaceRootsReact(): string[] {
  return workspaceRootsReact;
}

function existeComponenteUi(nombres: string[]): boolean {
  const cacheKey = nombres.join('|');
  const cached = cacheComponentesUi.get(cacheKey);
  if (cached !== undefined) { return cached; }

  const basesRelativas = [
    path.join('frontend', 'src', 'components', 'ui'),
    path.join('src', 'components', 'ui'),
    path.join('App', 'React', 'components', 'ui'),
    path.join('components', 'ui'),
    /* [318A-3] PROYECTO TASKS tiene el design system en frontend/src/app/components
     * (ui/ para componentes base, shared/ para compuestos tipo Range/ToggleSwitch) */
    path.join('frontend', 'src', 'app', 'components', 'ui'),
    path.join('frontend', 'src', 'app', 'components', 'shared'),
  ];
  const extensiones = ['tsx', 'ts', 'jsx', 'js'];

  for (const workspaceRoot of workspaceRootsReact) {
    for (const baseRelativa of basesRelativas) {
      for (const nombre of nombres) {
        for (const extension of extensiones) {
          const rutaArchivo = path.join(workspaceRoot, baseRelativa, `${nombre}.${extension}`);
          if (fs.existsSync(rutaArchivo)) {
            cacheComponentesUi.set(cacheKey, true);
            return true;
          }
        }
      }
    }
  }

  cacheComponentesUi.set(cacheKey, false);
  return false;
}

/*
 * Detecta mutaciones directas de estado React.
 * Busca .splice(), .push(), .pop() en variables que parezcan estado.
 */
export function verificarMutacionDirectaEstado(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  const nombresEstado = new Set<string>();
  for (const linea of lineas) {
    const match = /\[\s*(\w+)\s*,\s*set\w+\s*\]\s*=\s*useState/.exec(linea);
    if (match) {
      nombresEstado.add(match[1]);
    }
  }

  if (nombresEstado.size === 0) { return violaciones; }

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }

    for (const nombre of nombresEstado) {
      const regexMutacion = new RegExp(`\\b${nombre}\\s*\\.\\s*(push|splice|pop|shift|unshift|reverse|sort|fill)\\s*\\(`);
      if (regexMutacion.test(linea)) {
        violaciones.push({
          reglaId: 'mutacion-directa-estado',
          mensaje: `Mutacion directa en estado "${nombre}" con .${RegExp.$1}(). Usar spread/map para inmutabilidad.`,
          severidad: obtenerSeveridadRegla('mutacion-directa-estado'),
          linea: i,
          fuente: 'estatico',
        });
      }

      const regexAsignacion = new RegExp(`\\b${nombre}\\s*\\[`);
      if (regexAsignacion.test(linea) && /=\s*(?!=)/.test(linea.substring(linea.indexOf(nombre)))) {
        const despuesDeCorchete = linea.substring(linea.indexOf(nombre));
        if (/\]\s*=[^=]/.test(despuesDeCorchete)) {
          violaciones.push({
            reglaId: 'mutacion-directa-estado',
            mensaje: `Asignacion directa a "${nombre}[i]". Usar map() + spread para inmutabilidad.`,
            severidad: obtenerSeveridadRegla('mutacion-directa-estado'),
            linea: i,
            fuente: 'estatico',
          });
        }
      }
    }
  }

  return violaciones;
}

/*
 * Detecta key={index} en callbacks de .map().
 * Usar el indice como key causa reconciliacion incorrecta cuando items
 * se agregan, eliminan o reordenan. Usar un ID unico del item.
 */
export function verificarKeyIndexLista(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* [119A-4 S5] Receptores de slots fijos: useState/useMemo inicializados con
   * Array(N).fill(...) tienen longitud fija y orden estable (ej: slots de
   * imagenes): key={index} no causa reconciliacion incorrecta. Se detecta el
   * nombre del estado (const [x, setX] = ...) o de la variable directa. */
  const slotsFijos = new Set<string>();
  const textoCompleto = lineas.join('\n');
  const regexSlots = /(?:const|let|var)\s+(?:\[\s*(\w+)\s*,[^\]]*\]\s*=\s*(?:use\w+(?:<[^;]*?>)?\([^;]*?)?Array\s*\([^;]*?\)\.fill\s*\(|(\w+)\s*=\s*(?:use\w+(?:<[^;]*?>)?\([^;]*?)?Array\s*\([^;]*?\)\.fill\s*\()/g;
  let mSlot: RegExpExecArray | null;
  while ((mSlot = regexSlots.exec(textoCompleto)) !== null) {
    const nombre = mSlot[1] ?? mSlot[2];
    if (nombre) { slotsFijos.add(nombre); }
  }

  let dentroDeMap = false;
  let profundidadMap = 0;
  let receptorEsFijo = false;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    const matchMap = /(\w+)\.map\s*\(/.exec(linea);
    if (matchMap) {
      dentroDeMap = true;
      profundidadMap = 0;
      receptorEsFijo = slotsFijos.has(matchMap[1]);
    } else if (/\.map\s*\(/.test(linea)) {
      /* Map encadenado (ej: xs.filter(...).map(...)): sin receptor nombrable,
       * se analiza como lista dinamica igual que antes. */
      dentroDeMap = true;
      profundidadMap = 0;
      receptorEsFijo = false;
    }

    if (dentroDeMap) {
      for (const char of linea) {
        if (char === '(') { profundidadMap++; }
        if (char === ')') { profundidadMap--; }
      }

      if (!receptorEsFijo && /key\s*=\s*\{\s*(index|i|idx|indice)\s*\}/.test(linea)) {
        violaciones.push({
          reglaId: 'key-index-lista',
          mensaje: 'key={index} causa reconciliacion incorrecta en listas dinamicas. Usar ID unico del item.',
          severidad: obtenerSeveridadRegla('key-index-lista'),
          linea: i,
          fuente: 'estatico',
        });
      }

      if (profundidadMap <= 0) {
        dentroDeMap = false;
        receptorEsFijo = false;
      }
    }
  }

  return violaciones;
}

/*
 * Detecta componentes con logica excesiva que deberia extraerse a un hook.
 * Glory requiere: Componente.tsx (solo JSX) + useComponente.ts (logica).
 * Si hay >5 lineas de logica con estado/efectos entre imports y JSX return, reportar.
 */
export function verificarComponenteSinHook(lineas: string[], nombreArchivo: string): Violacion[] {
  if (/^use[A-Z]/.test(nombreArchivo)) { return []; }
  if (nombreArchivo.includes('.test.') || nombreArchivo.includes('.spec.') ||
      nombreArchivo.includes('_generated')) {
    return [];
  }

  /* [104A-4] Soporte sentinel-disable-file para esta regla */
  const texto = lineas.join('\n');
  if (texto.includes('sentinel-disable-file componente-sin-hook')) { return []; }

  const nombreComponente = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  const regexHookDedicado = new RegExp(`\\buse${nombreComponente}\\b`);
  const tieneHookDedicado = lineas.some(l => regexHookDedicado.test(l));
  if (tieneHookDedicado) { return []; }

  const violaciones: Violacion[] = [];

  let finImports = 0;
  let lineaReturn = -1;

  for (let i = 0; i < lineas.length; i++) {
    const lineaTrimmed = lineas[i].trim();
    if (/^import\s/.test(lineaTrimmed)) {
      finImports = i + 1;
    }
    if (/\breturn\s*\(\s*$|\breturn\s*</.test(lineaTrimmed)) {
      lineaReturn = i;
      break;
    }
  }

  if (lineaReturn <= finImports) { return violaciones; }

  let lineasLogicaTotal = 0;
  let lineasLogicaEstado = 0;
  const regexLogicaTotal = /\b(useEffect|useState|useMemo|useCallback|useRef|fetch\s*\(|await\s|try\s*\{|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|\.then\s*\()/;
  const regexLogicaEstado = /\b(useEffect|useState|useMemo|useCallback|useRef|fetch\s*\(|await\s|\.then\s*\()/;

  for (let i = finImports; i < lineaReturn; i++) {
    const lineaTrimmed = lineas[i].trim();

    if (lineaTrimmed === '' || esComentario(lineaTrimmed)) { continue; }

    /* Saltar destructuring de hook/props y firma del componente */
    if (/^(?:const|let)\s+\{.*\}\s*=\s*use\w+/.test(lineaTrimmed)) { continue; }
    if (/^(?:const|let)\s+\[.*\]\s*=\s*use\w+/.test(lineaTrimmed)) { continue; }
    if (/^(?:const|let)\s+\{.*\}\s*=\s*props/.test(lineaTrimmed)) { continue; }
    if (/^(?:export\s+)?(?:default\s+)?(?:function|const)\s+\w+/.test(lineaTrimmed) && !/useEffect|useState/.test(lineaTrimmed)) { continue; }

    if (regexLogicaTotal.test(lineaTrimmed)) { lineasLogicaTotal++; }
    if (regexLogicaEstado.test(lineaTrimmed)) { lineasLogicaEstado++; }
  }

  /* [124A-FP4] Criterio dual: logica con estado >5 O logica pura >10.
   * Componentes visuales deben contener minima logica — threshold 5 es correcto.
   * Si un componente tiene useState + >5 lineas de logica, la logica debe
   * extraerse a un hook dedicado (useMiComponente.ts). */
  const necesitaHook = (lineasLogicaEstado > 0 && lineasLogicaTotal > 5) || lineasLogicaTotal > 10;

  if (necesitaHook) {
    violaciones.push({
      reglaId: 'componente-sin-hook-glory',
      mensaje: `Componente con ${lineasLogicaTotal} lineas de logica (${lineasLogicaEstado} con estado/efectos). Extraer a hook dedicado (use${nombreComponente}).`,
      severidad: obtenerSeveridadRegla('componente-sin-hook-glory'),
      linea: finImports,
      sugerencia: `Crear use${nombreComponente}.ts con la logica y mantener solo JSX en el componente.`,
      fuente: 'estatico',
    });
  }

  return violaciones;
}

/*
 * Detecta uso de elementos HTML nativos que deberian ser componentes propios
 * del proyecto (Boton, Input, Select, Textarea, Checkbox, Radio, GloryLink).
 *
 * Excluye: archivos que SON los propios componentes UI, tests,
 * wrappers (Campo*, Toggle*, Switch*), Glory framework.
 */
export function verificarHtmlNativoEnVezDeComponente(lineas: string[], nombreArchivo: string): Violacion[] {
  const archivosExcluidos = [
    'Boton', 'BotonBase', 'Button', 'Input', 'Select', 'SelectorMenu', 'SelectorBase', 'SelectorPersonalizado',
    'Textarea', 'CampoTexto', 'Checkbox', 'Radio', 'GloryLink', 'PageRenderer', 'ModalAcciones',
    /* [318A-3] Range (components/shared) renderiza <input type="range"> y no debe auto-flaggearse */
    'Range',
  ];
  const nombreBase = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  if (archivosExcluidos.includes(nombreBase)) { return []; }

  const prefijosWrapper = ['Campo', 'Toggle', 'Switch'];
  if (prefijosWrapper.some(p => nombreBase.startsWith(p))) { return []; }

  if (nombreArchivo.includes('.test.') || nombreArchivo.includes('.spec.') ||
      nombreArchivo.includes('_generated')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  /* [104A-4] Soporte sentinel-disable-file para esta regla */
  const texto = lineas.join('\n');
  if (texto.includes('sentinel-disable-file html-nativo-en-vez-de-componente')) { return []; }

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

    if (tieneBotonUi && /<button[\s>]/.test(linea)) {
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
  if (texto.includes('sentinel-disable-file button-clase-especifica')) { return []; }

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

/*
 * Detecta patrones artesanales que reimplementan componentes
 * reutilizables del proyecto (MenuContextual, Modal, etc.).
 * - Outside-click listener artesanal -> usar MenuContextual
 * - Overlay/backdrop artesanal -> usar Modal
 */
export function verificarComponenteArtesanal(lineas: string[], nombreArchivo: string): Violacion[] {
  const componentesExcluidos = [
    /* Componentes del sistema UI — implementan los patrones ellos mismos */
    'MenuContextual', 'MenuContextualPR', 'Modal', 'ModalBase', 'ModalAcciones',
    'ModalInspectorSample', 'ModalFiltros', 'Dropdown',
    'DropdownNotificaciones', 'DropdownMensajes',
    'Popover', 'Tooltip', 'ContenedorToasts', 'Notificacion',
    /* Selectores propios — implementan overlay nativamente por diseno */
    'SelectorMenu', 'SelectorBase', 'Boton', 'BotonBase', 'CampoTexto',
  ];
  const nombreBase = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  if (componentesExcluidos.includes(nombreBase)) { return []; }

  if (/^use(?:MenuContextual|Modal|Dropdown|Popover|Tooltip)/i.test(nombreBase)) {
    return [];
  }

  if (nombreArchivo.includes('.test.') || nombreArchivo.includes('.spec.') ||
      nombreArchivo.includes('_generated')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (tieneSentinelDisable(lineas, i, 'componente-artesanal')) { continue; }
    if (linea.includes('sentinel-disable componente-artesanal')) { continue; }

    /* Patron 1: Outside-click listener artesanal */
    if (/document\.addEventListener\s*\(\s*['"](?:mousedown|click)['"]/i.test(linea)) {
      let dentroUseEffect = false;
      for (let j = Math.max(0, i - 15); j < i; j++) {
        if (/useEffect\s*\(/.test(lineas[j])) {
          dentroUseEffect = true;
          break;
        }
      }

      if (dentroUseEffect) {
        violaciones.push({
          reglaId: 'componente-artesanal',
          mensaje: 'Patron de menu/dropdown artesanal detectado (outside-click handler manual). Usar <MenuContextual> del sistema de componentes.',
          severidad: obtenerSeveridadRegla('componente-artesanal'),
          linea: i,
          sugerencia: 'Reemplazar con <MenuContextual items={...} abierto={...} onCerrar={...} />. Import desde components/ui.',
          fuente: 'estatico',
        });
      }
    }

    /* Patron 2: Overlay/backdrop artesanal */
    if (/<div\b[^>]*(?:className|class)\s*=/.test(linea)) {
      const tieneOverlay = /(?:overlay|backdrop|fondo(?:Modal|Oscuro)|fondoModal)/i.test(linea);
      const tieneOnClick = /onClick\s*=\s*\{/.test(linea);

      if (tieneOverlay && tieneOnClick) {
        violaciones.push({
          reglaId: 'componente-artesanal',
          mensaje: 'Patron de modal artesanal detectado (div overlay/backdrop con onClick). Usar <Modal> del sistema de componentes.',
          severidad: obtenerSeveridadRegla('componente-artesanal'),
          linea: i,
          sugerencia: 'Reemplazar con <Modal abierto={...} onCerrar={...}>contenido</Modal>. Import desde components/ui.',
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/*
 * Detecta update optimista (set() antes de await) sin rollback en catch.
 * Si la API falla, el UI queda mostrando el estado optimista sin revertir.
 */
export function verificarUpdateOptimistaSinRollback(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (!/\bset\s*\(\s*(?:\{|(?:prev|state|s)\s*=>)/.test(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'update-optimista-sin-rollback')) { continue; }

    /* Buscar un await en las siguientes 10 lineas */
    let lineaAwait = -1;
    for (let j = i + 1; j < Math.min(lineas.length, i + 10); j++) {
      if (/\bawait\b/.test(lineas[j])) {
        lineaAwait = j;
        break;
      }
    }

    if (lineaAwait === -1) { continue; }

    /* Buscar catch block despues del await */
    for (let j = lineaAwait; j < Math.min(lineas.length, lineaAwait + 30); j++) {
      if (!/\bcatch\s*\(/.test(lineas[j])) { continue; }

      let tieneRollback = false;
      let profundidad = 0;
      let dentroBloque = false;

      for (let k = j; k < Math.min(lineas.length, j + 20); k++) {
        for (const c of lineas[k]) {
          if (c === '{') { profundidad++; dentroBloque = true; }
          if (c === '}' && dentroBloque) { profundidad--; }
        }
        if (/\bset\s*\(/.test(lineas[k])) {
          tieneRollback = true;
          break;
        }
        if (dentroBloque && profundidad === 0) { break; }
      }

      if (!tieneRollback) {
        violaciones.push({
          reglaId: 'update-optimista-sin-rollback',
          mensaje: 'Update optimista: set() antes de await sin rollback en catch. Si la API falla, el UI queda inconsistente.',
          severidad: obtenerSeveridadRegla('update-optimista-sin-rollback'),
          linea: i,
          sugerencia: 'Guardar valor previo antes del set() optimista y restaurarlo en catch: catch(e) { set(valorPrevio); }',
          fuente: 'estatico',
        });
      }
      break;
    }
  }

  return violaciones;
}

/*
 * Detecta .push() a arrays de cola/buffer sin verificar limite de tamano.
 * Un array que crece sin control puede causar memory leaks.
 */
export function verificarColaSinLimite(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  const patronCola = /\b(\w*(?:cola|queue|buffer|pending|batch|stack))\s*\.\s*push\s*\(/i;

  for (let i = 0; i < lineas.length; i++) {
    if (tieneSentinelDisable(lineas, i, 'cola-sin-limite')) { continue; }
    if (esComentario(lineas[i])) { continue; }

    const match = patronCola.exec(lineas[i]);
    if (!match) { continue; }

    const nombreVar = match[1];

    /* Buscar .length check en las 5 lineas anteriores */
    let tieneCheckLimite = false;
    for (let j = Math.max(0, i - 5); j < i; j++) {
      if (new RegExp(`${nombreVar}\\.length`).test(lineas[j]) ||
          /\bMAX_|MAX_SIZE|LIMITE|CAPACITY/i.test(lineas[j])) {
        tieneCheckLimite = true;
        break;
      }
    }

    if (!tieneCheckLimite) {
      violaciones.push({
        reglaId: 'cola-sin-limite',
        mensaje: `"${nombreVar}.push()" sin verificar tamano. Un array que crece sin control causa memory leaks.`,
        severidad: obtenerSeveridadRegla('cola-sin-limite'),
        linea: i,
        fuente: 'estatico',
        sugerencia: `Agregar check de limite: if (${nombreVar}.length < MAX_SIZE) { ${nombreVar}.push(...) }`,
      });
    }
  }

  return violaciones;
}

/*
 * Detecta export const de objetos/arrays mutables al nivel de modulo.
 * Estos se comparten entre todos los importadores y sus mutaciones
 * generan efectos laterales dificiles de rastrear.
 */
export function verificarObjetoMutableExportado(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  const patronExportMutable = /^export\s+const\s+(\w+)\s*(?::\s*\w[^=]*)?\s*=\s*(\{|\[)/;

  for (let i = 0; i < lineas.length; i++) {
    if (tieneSentinelDisable(lineas, i, 'objeto-mutable-exportado')) { continue; }
    if (esComentario(lineas[i])) { continue; }

    const match = patronExportMutable.exec(lineas[i].trim());
    if (!match) { continue; }

    const nombre = match[1];

    /* Excluir patrones comunes que son intencionalmente mutables (ej: registros, maps, definiciones de bloque) */
    if (/REGISTRO|registry|MAPA|Definition/i.test(nombre)) { continue; }

    /* Verificar si el bloque exportado es inmutable.
     * [044A-14] Escanea hasta el cierre del bloque (o nueva declaracion) en vez de solo 5 lineas,
     * para detectar as const satisfies al final de objetos grandes. */
    let esInmutable = false;
    if (/readonly/.test(lineas[i])) {
      esInmutable = true;
    } else {
      const limiteLineas = Math.min(lineas.length, i + 100);
      for (let j = i; j < limiteLineas; j++) {
        if (/Object\.freeze/.test(lineas[j]) || /as\s+const/.test(lineas[j])) {
          esInmutable = true;
          break;
        }
        /* Si encontramos otra declaracion top-level, el bloque export termino */
        if (j > i && /^(export\s|function\s|class\s|interface\s|type\s)/.test(lineas[j].trim())) {
          break;
        }
      }
    }

    if (!esInmutable) {
      violaciones.push({
        reglaId: 'objeto-mutable-exportado',
        mensaje: `"export const ${nombre}" exporta un ${match[2] === '{' ? 'objeto' : 'array'} mutable. Mutaciones afectan a todos los importadores.`,
        severidad: obtenerSeveridadRegla('objeto-mutable-exportado'),
        linea: i,
        fuente: 'estatico',
        sugerencia: `Usar "as const", Object.freeze(), o una funcion factory: export const get${nombre} = () => (${match[2] === '{' ? '{ ... }' : '[ ... ]'}).`,
      });
    }
  }

  return violaciones;
}

/* [149A-1 0.7.12] Split mecanico por budget ADR 0001: las reglas de Modal
 * viven en reactModalRules.ts (movimiento puro, cero cambio de
 * comportamiento). Re-export para no tocar importadores. */
export {
  verificarModalConTitulo,
  verificarModalAccionesNoCanonico,
  verificarModalEstructuraNoCanonica,
} from './reactModalRules';

/*
 * Detecta cuando <MenuContextual> recibe className, panelClassName,
 * triggerClassName o itemClassName con un valor no vacio. Esas props inyectan especificaciones de
 * diseno locales en un componente canonico compartido: el override correcto es
 * modificar el sistema UI, no parchar via prop.
 *
 * La regla busca el bloque JSX de <MenuContextual ... /> o <MenuContextual ...>
 * hasta el cierre o una linea en blanco, y reporta en la linea exacta donde
 * aparece la prop problemática.
 */
export function verificarMenuContextualOverride(lineas: string[], nombreArchivo = ''): Violacion[] {
  const base = nombreArchivo.split(/[/\\]/).pop() ?? '';
  /* [119A-4 S3] El propio componente documenta/usa sus props en su fichero;
   * auto-flagguearse no es deuda del consumidor. */
  if (/^MenuContextual\.(tsx|jsx)$/.test(base)) { return []; }

  const violaciones: Violacion[] = [];
  const PROPS_OVERRIDE = ['className', 'panelClassName', 'triggerClassName', 'itemClassName'];
  /* Cadenas entrecomilladas en una linea: para no confundir '>' dentro de
   * strings con el cierre del tag de apertura. */
  const STRIP_STRINGS = /'(?:[^'\\\r\n]|\\.)*'|"(?:[^"\\\r\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

  for (let i = 0; i < lineas.length; i++) {
    if (!/<MenuContextual[\s>]/.test(lineas[i])) { continue; }

    /* [119A-4 S3] Delimitar el tag de apertura: primer '>' a profundidad 0
     * de llaves (ignora '>' dentro de props como trigger={<Boton ...>}).
     * Antes el escaneo seguia hasta 15 lineas e incluia hijos/hermanos. */
    const fin = Math.min(i + 15, lineas.length);
    let finTag = -1;
    let profundidadLlaves = 0;
    for (let j = i; j < fin; j++) {
      const sinStrings = lineas[j].replace(STRIP_STRINGS, '""');
      for (const ch of sinStrings) {
        if (ch === '{') { profundidadLlaves++; }
        else if (ch === '}') { profundidadLlaves = Math.max(0, profundidadLlaves - 1); }
        else if (ch === '>' && profundidadLlaves === 0) { finTag = j; break; }
      }
      if (finTag >= 0) { break; }
    }
    if (finTag < 0) { finTag = fin - 1; }

    for (let j = i; j <= finTag; j++) {
      const linea = lineas[j];

      if (tieneSentinelDisable(lineas, j, 'menu-contextual-override-diseno')) { continue; }

      for (const prop of PROPS_OVERRIDE) {
        /* className="algo" o className={`algo`} o className={'algo'} */
        const regex = new RegExp(`(?:^|\\s)${prop}\\s*=\\s*(?:["'\`]([^"'\`]+)["'\`]|\\{["'\`]([^"'\`]+)["'\`]\\})`);
        const match = regex.exec(linea);
        if (match) {
          const valor = (match[1] ?? match[2] ?? '').trim();
          if (valor) {
            violaciones.push({
              reglaId: 'menu-contextual-override-diseno',
              mensaje: `"${prop}=${valor}" inyecta diseno local en <MenuContextual>. Modifica el sistema UI (ContextMenu.css) en vez de parchear via prop.`,
              severidad: obtenerSeveridadRegla('menu-contextual-override-diseno'),
              linea: j,
              fuente: 'estatico',
            });
          }
        }
      }
    }
  }

  return violaciones;
}
