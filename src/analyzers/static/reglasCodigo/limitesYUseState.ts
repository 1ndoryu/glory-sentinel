/*
 * Reglas de limite de lineas y useState excesivo, extraidas de staticCodeRules.ts.
 * limite-lineas (cuatro escalas) y usestate-excesivo.
 */

import { Violacion } from '../../../types';
import { CoreTextDocument } from '../../../core/runtime-proyecto/types';
import { contarLineasEfectivas, obtenerLimiteArchivo } from '../../../utils/lineCounter';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { obtenerSeveridadRegla, reglaHabilitada } from '../../../config/ruleRegistry';

interface EscalaLimiteLineas {
  reglaId: string;
  factor: number;
  mensaje: (tipo: string, limite: number, lineasEfectivas: number) => string;
  quickFixId?: string;
}

export const REGLAS_LIMITE_LINEAS = [
  'limite-lineas',
  'limite-lineas-nivel-2',
  'limite-lineas-nivel-3',
  'limite-lineas-nivel-4',
] as const;

const ESCALAS_LIMITE_LINEAS: EscalaLimiteLineas[] = [
  {
    reglaId: 'limite-lineas',
    factor: 1,
    quickFixId: 'mark-split-todo',
    mensaje: (tipo, limite, lineasEfectivas) =>
      `Archivo excede limite de ${limite} lineas para ${tipo} (${lineasEfectivas} lineas efectivas). Dividir obligatoriamente.`,
  },
  {
    reglaId: 'limite-lineas-nivel-2',
    factor: 2,
    mensaje: (tipo, limite, lineasEfectivas) =>
      `ALTO: este ${tipo} duplica el limite (${lineasEfectivas}/${limite}). No lo tapes con sentinel-disable-file; separa contratos, requests, responses y helpers ahora.`,
  },
  {
    reglaId: 'limite-lineas-nivel-3',
    factor: 3,
    mensaje: (tipo, limite, lineasEfectivas) =>
      `BASTA: este ${tipo} triplica el limite (${lineasEfectivas}/${limite}). Un archivo asi ya no es excepcion, es deuda activa. Refactor obligatorio antes de seguir agregando codigo.`,
  },
  {
    reglaId: 'limite-lineas-nivel-4',
    factor: 5,
    mensaje: (tipo, limite, lineasEfectivas) =>
      `NO DISIMULES ESTE DESASTRE: ${lineasEfectivas} lineas efectivas para un limite de ${limite}. sentinel-disable-file no es anestesia para archivos monstruosos; crea una carpeta y divide el modulo.`,
  },
];

/* Verifica si el archivo excede los limites de lineas del protocolo.
 * Soporta excepciones con sentinel-disable-file limite-lineas */
export function verificarLimiteLineas(
  documento: CoreTextDocument,
  nombreArchivo: string,
): Violacion[] {
  const texto = documento.getText();

  const limite = obtenerLimiteArchivo(nombreArchivo, documento.fileName);
  if (!limite) { return []; }

  const esRust = nombreArchivo.endsWith('.rs');
  const lineasEfectivas = contarLineasEfectivas(texto, esRust);
  if (lineasEfectivas <= limite.limite) { return []; }

  const ultimaLinea = Math.max(0, documento.lineCount - 1);

  return ESCALAS_LIMITE_LINEAS
    .filter(escala => reglaHabilitada(escala.reglaId))
    .filter(escala => lineasEfectivas > Math.ceil(limite.limite * escala.factor))
    .filter(escala => !tieneDisableFile(texto, escala.reglaId))
    .map(escala => ({
      reglaId: escala.reglaId,
      mensaje: escala.mensaje(limite.tipo, limite.limite, lineasEfectivas),
      severidad: obtenerSeveridadRegla(escala.reglaId),
      linea: ultimaLinea,
      quickFixId: escala.quickFixId,
      fuente: 'estatico' as const,
    }));
}

/* [225A-1] Parser compartido por las escalas de limite-lineas: cada nivel usa
 * su propio rule id para que desactivar el primer aviso no silencie los graves. */
function tieneDisableFile(texto: string, reglaId: string): boolean {
  return texto.split('\n').some(linea => {
    const idx = linea.indexOf('sentinel-disable-file');
    if (idx === -1) { return false; }
    const tokens = linea
      .slice(idx + 'sentinel-disable-file'.length)
      .replace(/[:*/]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    return tokens.includes(reglaId);
  });
}

/* Verifica si un componente React tiene mas de 3 useState.
 * Cuenta por componente individual para evitar falsos positivos
 * en archivos con multiples sub-componentes. */
export function verificarUseStateExcesivo(
  texto: string,
  _documento: CoreTextDocument,
): Violacion[] {
  /* [104A-4] Soporte sentinel-disable-file para esta regla */
  if (tieneSentinelDisableFile(texto, 'usestate-excesivo')) { return []; }

  const componentDeclarations = texto.match(/(?:const|function)\s+[A-Z][A-Za-z]*\s*(?:=|\()/g) || [];
  const numComponentes = Math.max(1, componentDeclarations.length);

  const matches = texto.match(/\buseState\s*[<(]/g);
  const totalUseState = matches ? matches.length : 0;

  if (totalUseState <= 3 * numComponentes) { return []; }

  if (numComponentes === 1 && totalUseState > 3) {
    return [{
      reglaId: 'usestate-excesivo',
      mensaje: `${totalUseState} useState detectados (max 3). Extraer logica a un hook personalizado.`,
      severidad: obtenerSeveridadRegla('usestate-excesivo'),
      linea: 0,
      quickFixId: 'extract-to-hook',
      fuente: 'estatico',
    }];
  }

  return [];
}
