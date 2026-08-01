/*
 * [018A-5] Reglas de arquitectura portables nacidas en el proyecto consumidor.
 *
 * Estas detecciones deliberadamente reciben boundaries por configuración: el
 * núcleo no conoce `frontend/src`, nombres de clases ni la estructura de
 * wandori.us. Son heurísticas de bajo acoplamiento; por eso reportan warning o
 * hint y dejan la decisión de bloqueo a la política del consumidor.
 */

import { CoreTextDocument } from '../../core/types';
import { obtenerSeveridadRegla, reglaHabilitada } from '../../config/ruleRegistry';
import { Violacion } from '../../types';

export interface PortableBoundaryConfig {
  dom?: string[];
  window?: string[];
  services?: string[];
  loggerModules?: string[];
}

const EXTENSIONES_JS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const DEFAULT_DOM_BOUNDARIES = ['/platform/', '/adapters/', '/dom.'];
const DEFAULT_WINDOW_BOUNDARIES = ['/platform/', '/adapters/', '/navigation/'];
const DEFAULT_SERVICE_BOUNDARIES = ['/services/', '/adapters/', '/api/', '/repositories/'];
const DEFAULT_LOGGER_MODULES = ['/logger.', '/logging/'];

function normalizePath(fileName: string): string {
  return `/${fileName.replace(/\\/g, '/').replace(/^\/+/, '')}`.toLowerCase();
}

function isTestOrTooling(fileName: string): boolean {
  return /(?:\.test|\.spec|\/__tests__|\/scripts\/|\/test\/|\/fixtures?)/i.test(normalizePath(fileName));
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

function countInterfaceFields(body: string): number {
  return (body.match(/^\s*[A-Za-z_$][\w$]*\??\s*:/gm) ?? []).length;
}

/** Ejecuta únicamente sobre JavaScript/TypeScript de aplicación. */
export function verificarReglasPortables(
  document: CoreTextDocument,
  boundaries: PortableBoundaryConfig = {},
): Violacion[] {
  const extension = `.${document.fileName.split('.').pop()?.toLowerCase() ?? ''}`;
  if (!EXTENSIONES_JS.has(extension) || isTestOrTooling(document.fileName)) return [];

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

  lines.forEach((line, index) => {
    const code = line.replace(/\/\/.*$/, '').trim();
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

  if (hasExportedLogic(text) && /\bexport\s*\{[^}]+\}\s*from\b/.test(text)) {
    addFinding(findings, 'mixed-barrel-logic', document, 0,
      'Módulo mezcla re-export y lógica ejecutable.',
      'Separa el barrel del módulo de implementación.');
  }

  for (const match of text.matchAll(/interface\s+[A-Za-z_$][\w$]*\s*\{([\s\S]*?)\}/g)) {
    const fields = countInterfaceFields(match[1]);
    if (fields > 10) {
      const line = text.slice(0, match.index ?? 0).split(/\r\n|\r|\n/).length - 1;
      addFinding(findings, 'large-interface-isp', document, line,
        `Interface con ${fields} campos; puede violar ISP.`,
        'Divide el contrato en subinterfaces cohesivas.');
    }
  }

  return findings;
}
