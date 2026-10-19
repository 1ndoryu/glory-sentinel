/*
 * [018A-5] Reglas de arquitectura portables nacidas en el proyecto consumidor.
 *
 * Estas detecciones deliberadamente reciben boundaries por configuración: el
 * núcleo no conoce `frontend/src`, nombres de clases ni la estructura de
 * wandori.us. Son heurísticas de bajo acoplamiento; por eso reportan warning o
 * hint y dejan la decisión de bloqueo a la política del consumidor.
 */

import { CoreTextDocument } from '../../core/runtime-proyecto/types';
import { obtenerSeveridadRegla, reglaHabilitada } from '../../config/ruleRegistry';
import { Violacion } from '../../types';
import { tieneSentinelDisable, tieneSentinelDisableFile } from '../../utils/analisisHelpers';
import { extensionCanonica } from '../../core/runtime-proyecto/language';

export interface PortableBoundaryConfig {
  dom?: string[];
  window?: string[];
  services?: string[];
  loggerModules?: string[];
  /* Carpetas de herramientas: scripts sueltos, cuadernos de trabajo y codigo
   * generado que no es producto. Se SUMAN a las de serie, no las sustituyen. */
  tooling?: string[];
}

const EXTENSIONES_JS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const DEFAULT_DOM_BOUNDARIES = ['/platform/', '/adapters/', '/dom.'];
const DEFAULT_WINDOW_BOUNDARIES = ['/platform/', '/adapters/', '/navigation/'];
const DEFAULT_SERVICE_BOUNDARIES = ['/services/', '/adapters/', '/api/', '/repositories/'];
const DEFAULT_LOGGER_MODULES = ['/logger.', '/logging/'];
const DEFAULT_TOOLING_BOUNDARIES = ['/__tests__/', '/test/', '/fixture', '/scripts/'];

function normalizePath(fileName: string): string {
  return `/${fileName.replace(/\\/g, '/').replace(/^\/+/, '')}`.toLowerCase();
}

/* Sufijo del nombre de fichero de prueba (no es una carpeta, asi que no cabe en
 * una lista de boundaries). */
const PATRON_PRUEBA = /(?:\.test|\.spec)/i;

/* [por que] Las carpetas de herramientas eran una lista fija en el codigo
 * (`/scripts/`, `/test/`, ...) que no puede conocer los directorios de trabajo
 * de cada proyecto: en uno con `.freebuff/` de scripts de prueba, los 145
 * `console.log` de ahi se reportaban como `console-production` de produccion.
 * Ahora las declara el consumidor en `portableBoundaries.tooling`, que se SUMA
 * a las de serie. */
function isTestOrTooling(fileName: string, tooling: string[]): boolean {
  const normalizado = normalizePath(fileName);
  return PATRON_PRUEBA.test(normalizado) || inBoundary(normalizado, tooling);
}

function inBoundary(fileName: string, boundaries: string[]): boolean {
  const normalized = normalizePath(fileName);
  return boundaries.some(boundary => {
    const value = boundary.replace(/\\/g, '/').toLowerCase();
    return normalized.includes(value.startsWith('/') ? value : `/${value}`);
  });
}

function addFinding(
  findings: Violacion[],
  reglaId: string,
  document: CoreTextDocument,
  linea: number,
  mensaje: string,
  sugerencia: string,
  columna = 0,
): void {
  if (!reglaHabilitada(reglaId)) return;
  findings.push({
    reglaId,
    mensaje,
    severidad: obtenerSeveridadRegla(reglaId),
    linea,
    columna,
    sugerencia,
    fuente: 'estatico',
  });
}

function hasExportedLogic(text: string): boolean {
  return /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\b/.test(text);
}

/* [15A-25] Deja cada linea con sus literales y sus comentarios fuera, para no
 * leer como codigo lo que es texto. Antes solo se quitaba `//` con un `replace`
 * por linea, de modo que el cuerpo de un comentario de bloque se analizaba como
 * codigo: los cinco `window-reference-outside-platform` de KAMPLES salian de
 * comentarios que documentan justamente por que NO se usa `window.location`.
 * Un comentario de bloque cruza lineas, asi que el estado viaja entre ellas y
 * un `replace` por linea no basta. Orden dentro de la linea: primero literales
 * (para no truncar en el `//` de una URL), luego `//`, luego `/* ... *\/`. */
function lineasSinComentariosNiLiterales(lineas: string[]): string[] {
  let enBloque = false;
  return lineas.map(lineaOriginal => {
    let linea = lineaOriginal;
    let salida = '';
    for (;;) {
      if (enBloque) {
        const cierre = linea.indexOf('*/');
        if (cierre === -1) return salida.trim();
        enBloque = false;
        linea = linea.slice(cierre + 2);
        continue;
      }
      const sinStrings = linea.replace(/'(?:[^'\\\r\n]|\\.)*'|"(?:[^"\\\r\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
      const sinLinea = sinStrings.replace(/\/\/.*$/, '');
      const apertura = sinLinea.indexOf('/*');
      if (apertura === -1) return (salida + sinLinea).trim();
      const cierre = sinLinea.indexOf('*/', apertura + 2);
      salida += sinLinea.slice(0, apertura);
      if (cierre === -1) {
        enBloque = true;
        return salida.trim();
      }
      linea = sinLinea.slice(cierre + 2);
    }
  });
}

/** Ejecuta únicamente sobre JavaScript/TypeScript de aplicación. */
export function verificarReglasPortables(
  document: CoreTextDocument,
  boundaries: PortableBoundaryConfig = {},
): Violacion[] {
  const extension = extensionCanonica(`.${document.fileName.split('.').pop()?.toLowerCase() ?? ''}`);
  const toolingBoundaries = [...DEFAULT_TOOLING_BOUNDARIES, ...(boundaries.tooling ?? [])];
  if (!EXTENSIONES_JS.has(extension) || isTestOrTooling(document.fileName, toolingBoundaries)) return [];

  const text = document.getText();
  const lines = text.split(/\r\n|\r|\n/);
  const findings: Violacion[] = [];
  const domBoundaries = boundaries.dom ?? DEFAULT_DOM_BOUNDARIES;
  const windowBoundaries = boundaries.window ?? DEFAULT_WINDOW_BOUNDARIES;
  const serviceBoundaries = boundaries.services ?? DEFAULT_SERVICE_BOUNDARIES;
  const loggerModules = boundaries.loggerModules ?? DEFAULT_LOGGER_MODULES;
  const isDomBoundary = inBoundary(document.fileName, domBoundaries);
  const isWindowBoundary = inBoundary(document.fileName, windowBoundaries);
  const isServiceBoundary = inBoundary(document.fileName, serviceBoundaries);
  const isLoggerModule = inBoundary(document.fileName, loggerModules);

  /* [119A-4 S6] Despojar literales y comentarios antes de testear: 'window.location'
   * dentro de un string es documentacion/texto, no una referencia real (FP en
   * etiquetas.ts del allowlist). */
  const codigo = lineasSinComentariosNiLiterales(lines);

  codigo.forEach((code, index) => {
    if (!code) return;

    if (!isDomBoundary && /\b(?:document|globalThis\.document)\.(?:createElement|querySelector|querySelectorAll|getElementById|body|head)\b/.test(code)) {
      addFinding(findings, 'dom-access-outside-platform', document, index,
        'Acceso DOM directo fuera del boundary de plataforma.',
        'Mueve el acceso a un adapter de plataforma configurable.');
    }

    if (!isWindowBoundary && /\b(?:window|globalThis\.window)\.(?:location|history|scrollTo|innerWidth|innerHeight|addEventListener)\b/.test(code)) {
      addFinding(findings, 'window-reference-outside-platform', document, index,
        'Referencia window directa fuera del boundary de plataforma.',
        'Usa un adapter de navegación, viewport o lifecycle.');
    }

    if (!isServiceBoundary && /\bapi\.(?:get|post|put|patch|delete)\s*\(/.test(code)) {
      addFinding(findings, 'api-call-outside-service', document, index,
        'Llamada API fuera de un service/adaptador declarado.',
        'Mueve la llamada al boundary de servicio y deja la UI con un contrato tipado.');
    }

    if (!isLoggerModule && /\bconsole\.(?:log|error|warn|debug)\s*\(/.test(code)) {
      addFinding(findings, 'console-production', document, index,
        'Console directa en código de producción.',
        'Usa un logger o feedback visible inyectable.');
    }

    if (/\b(?:shell\s*:\s*true|exec(?:Sync)?\s*\([^)]*(?:\+|\$\{))/.test(code)) {
      addFinding(findings, 'unsafe-process-shell', document, index,
        'Proceso externo con shell o argumentos concatenados.',
        'Usa argumentos separados y shell:false.');
    }

    if (/\bexport\s+default\b/.test(code)) {
      addFinding(findings, 'default-export', document, index,
        'Default export en módulo de aplicación.',
        'Prefiere named exports para facilitar composición y análisis.');
    }

    if (/^\s*export\s+(?:const|let|var)\s+\w+\s*=\s*new\s+(?:Map|Set|WeakMap|WeakSet)\b/.test(code)) {
      addFinding(findings, 'singleton-mutable-state', document, index,
        'Estado mutable exportado a nivel de módulo.',
        'Mueve el estado a un store o ciclo de vida explícito.');
    }
  });

  /* [08AA-26] Un unico re-export es alias de compatibilidad (caso
   * ficha-ask.ts: `export { calcularCompletitud } from './pasos-ask'`
   * documentado para no romper imports), no un barrel: exigir ≥2. */
  const reExports = text.match(/^\s*export\s*(?:\{[^}]*\}|\*)\s*from\s*['"]/gm) ?? [];
  if (hasExportedLogic(text) && reExports.length >= 2) {
    addFinding(findings, 'mixed-barrel-logic', document, 0,
      'Módulo mezcla re-export y lógica ejecutable.',
      'Separa el barrel del módulo de implementación.');
  }

  for (const match of text.matchAll(/interface\s+[A-Za-z_$][\w$]*\s*\{([\s\S]*?)\}/g)) {
    const metodos = (match[1].match(/^\s*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::|=>)/gm) ?? []).length;
    /* [08AA-26] ISP aplica a contratos de comportamiento: solo los metodos
     * cuentan. Las propiedades de datos (DTO espejo de API, p. ej.
     * ClienteDuena en cliente-duena.ts) no imponen carga de implementacion;
     * contarlas daba falsos positivos. */
    if (metodos > 10) {
      const lineas = text.split(/\r\n|\r|\n/);
      const line = text.slice(0, match.index ?? 0).split(/\r\n|\r|\n/).length - 1;
      /* Honra `sentinel-disable-file` y `sentinel-disable-next-line` (contrato
       * de CHANGELOG 0.7.x). Sin esto la supresion del consumidor no surtia
       * efecto y el hint volvia en cada escaneo. */
      if (tieneSentinelDisableFile(text, 'large-interface-isp') || tieneSentinelDisable(lineas, line, 'large-interface-isp')) continue;
      addFinding(findings, 'large-interface-isp', document, line,
        `Interface con ${metodos} metodos; puede violar ISP.`,
        'Divide el contrato en subinterfaces cohesivas.');
    }
  }

  return findings;
}
