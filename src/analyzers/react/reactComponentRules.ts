/*
 * Reglas de arquitectura de componentes React.
 * Detecta: mutacion directa de estado, key-index en listas,
 * componente sin hook dedicado, HTML nativo en vez de componente,
 * componente artesanal, update optimista sin rollback.
 */

import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';

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
  let dentroDeMap = false;
  let profundidadMap = 0;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (/\.map\s*\(/.test(linea)) {
      dentroDeMap = true;
      profundidadMap = 0;
    }

    if (dentroDeMap) {
      for (const char of linea) {
        if (char === '(') { profundidadMap++; }
        if (char === ')') { profundidadMap--; }
      }

      if (/key\s*=\s*\{\s*(index|i|idx|indice)\s*\}/.test(linea)) {
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

  /* Criterio dual: logica con estado >5 O logica pura >10 */
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
    'Boton', 'BotonBase', 'Input', 'Select', 'SelectorMenu', 'SelectorBase',
    'Textarea', 'CampoTexto', 'Checkbox', 'Radio', 'GloryLink', 'PageRenderer', 'ModalAcciones',
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

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'html-nativo-en-vez-de-componente')) { continue; }
    /* Tambien skip inline sentinel-disable */
    if (linea.includes('sentinel-disable html-nativo-en-vez-de-componente')) { continue; }

    if (/<button[\s>]/.test(linea)) {
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar componente <Boton> en vez de <button> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    if (/<input[\s/]/.test(linea)) {
      if (/type\s*=\s*["']hidden["']/i.test(linea)) { continue; }
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar componente <Input> (o <Checkbox>/<Radio> segun type) en vez de <input> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    if (/<select[\s>]/.test(linea)) {
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar componente <Select> en vez de <select> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    if (/<textarea[\s>]/.test(linea)) {
      violaciones.push({
        reglaId: 'html-nativo-en-vez-de-componente',
        mensaje: 'Usar componente <Textarea> en vez de <textarea> nativo. Import desde components/ui.',
        severidad: obtenerSeveridadRegla('html-nativo-en-vez-de-componente'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    if (/<a\s+(?:[^>]*\s)?href\s*=/i.test(linea)) {
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

    /* Excluir patrones comunes que son intencionalmente mutables (ej: registros, maps) */
    if (/REGISTRO|registry|MAPA/i.test(nombre)) { continue; }

    /* Verificar si la linea anterior tiene Object.freeze o as const */
    let esInmutable = false;
    const contexto = lineas.slice(i, Math.min(lineas.length, i + 5)).join(' ');
    if (/Object\.freeze/.test(contexto) || /as\s+const/.test(contexto) || /readonly/.test(lineas[i])) {
      esInmutable = true;
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
