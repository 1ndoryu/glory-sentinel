/*
 * Reglas de reimplementacion de overlays y componentes canonicos: menus y
 * modales artesanales, y overrides de props en MenuContextual. El fallo es el
 * mismo: reescribir o parchar un componente del sistema UI.
 */

import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { tieneSentinelDisable, tieneSentinelDisableFile } from '../../../utils/analisisHelpers';

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

  /* [259A-5] File-level: overlays/backdrops intencionales (fase visual con
   * verificacion en navegador) se eximen por archivo. */
  const textoArtesanal = lineas.join('\n');
  if (tieneSentinelDisableFile(textoArtesanal, 'componente-artesanal')) { return []; }

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

  /* [259A-5] File-level: variantes por instancia via props (API publica del DS)
   * se eximen por archivo hasta su canonizacion en el sistema. */
  const textoMenu = lineas.join('\n');
  if (tieneSentinelDisableFile(textoMenu, 'menu-contextual-override-diseno')) { return []; }

  const PROPS_OVERRIDE = ['className', 'panelClassName', 'triggerClassName', 'itemClassName'];  /* Cadenas entrecomilladas en una linea: para no confundir '>' dentro de
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
