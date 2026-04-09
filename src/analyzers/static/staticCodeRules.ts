/*
 * Reglas de estructura y calidad de codigo para el analyzer estatico.
 * Detecta: limites de lineas, useState excesivo, imports muertos,
 * any type explicito, non-null assertion excesivo.
 */

import * as vscode from 'vscode';
import { Violacion } from '../../types';
import { contarLineasEfectivas, obtenerLimiteArchivo } from '../../utils/lineCounter';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';

/* Verifica si el archivo excede los limites de lineas del protocolo.
 * Soporta excepciones con sentinel-disable-file limite-lineas */
export function verificarLimiteLineas(
  documento: vscode.TextDocument,
  nombreArchivo: string,
): Violacion[] {
  const texto = documento.getText();

  if (texto.includes('sentinel-disable-file limite-lineas')) {
    return [];
  }

  const limite = obtenerLimiteArchivo(nombreArchivo, documento.fileName);
  if (!limite) { return []; }

  const lineasEfectivas = contarLineasEfectivas(texto);
  if (lineasEfectivas <= limite.limite) { return []; }

  const ultimaLinea = Math.max(0, documento.lineCount - 1);

  return [{
    reglaId: 'limite-lineas',
    mensaje: `Archivo excede limite de ${limite.limite} lineas para ${limite.tipo} (${lineasEfectivas} lineas efectivas). Dividir obligatoriamente.`,
    severidad: obtenerSeveridadRegla('limite-lineas'),
    linea: ultimaLinea,
    quickFixId: 'mark-split-todo',
    fuente: 'estatico',
  }];
}

/* Verifica si un componente React tiene mas de 3 useState.
 * Cuenta por componente individual para evitar falsos positivos
 * en archivos con multiples sub-componentes. */
export function verificarUseStateExcesivo(
  texto: string,
  documento: vscode.TextDocument,
): Violacion[] {
  /* [104A-4] Soporte sentinel-disable-file para esta regla */
  if (texto.includes('sentinel-disable-file usestate-excesivo')) { return []; }

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

/* Detecta imports sin uso en archivos JS/TS (heuristico simplificado) */
export function verificarImportsMuertos(
  texto: string,
  documento: vscode.TextDocument,
): Violacion[] {
  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaTrimmed = linea.trim();

    /* Saltar comentarios */
    if (lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/*')) {
      continue;
    }

    /* Import nombrado: import { X, Y } from '...' */
    const matchNombrado = /import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/.exec(linea);
    if (matchNombrado) {
      const nombres = matchNombrado[1]
        .split(',')
        .map(n => {
          const limpio = n.trim().replace(/^type\s+/, '');
          return limpio.split(' as ').pop()?.trim();
        })
        .filter(Boolean) as string[];
      const restoTexto = texto.substring(texto.indexOf('\n', texto.indexOf(linea)) + 1);

      for (const nombre of nombres) {
        const regexUso = new RegExp(`\\b${escapeRegex(nombre)}\\b`);
        if (!regexUso.test(restoTexto)) {
          violaciones.push({
            reglaId: 'import-muerto',
            mensaje: `Import "${nombre}" no se usa en el archivo. Eliminar.`,
            severidad: obtenerSeveridadRegla('import-muerto'),
            linea: i,
            quickFixId: 'remove-dead-import',
            fuente: 'estatico',
          });
        }
      }
    }

    /* Import default: import Nombre from '...' (excluyendo type imports) */
    const matchDefault = /^import\s+(?!type\s)(\w+)\s+from\s+['"][^'"]+['"]/.exec(linea);
    if (matchDefault) {
      const nombre = matchDefault[1];
      const restoTexto = texto.substring(texto.indexOf('\n', texto.indexOf(linea)) + 1);
      const regexUso = new RegExp(`\\b${escapeRegex(nombre)}\\b`);

      if (!regexUso.test(restoTexto)) {
        violaciones.push({
          reglaId: 'import-muerto',
          mensaje: `Import "${nombre}" no se usa en el archivo. Eliminar.`,
          severidad: obtenerSeveridadRegla('import-muerto'),
          linea: i,
          quickFixId: 'remove-dead-import',
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/* Detecta uso de `: any` o `as any` en archivos TS/TSX */
export function verificarAnyType(texto: string, documento: vscode.TextDocument): Violacion[] {
  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaTrimmed = linea.trim();

    if (lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('*') ||
        lineaTrimmed.startsWith('/*') || lineaTrimmed.startsWith('#')) {
      continue;
    }

    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line any-type-explicito')) { continue; }
    if (linea.includes('sentinel-disable any-type-explicito')) { continue; }

    if (/:\s*any\b|as\s+any\b/.test(linea)) {
      if (/eslint-disable|@ts-/.test(linea)) { continue; }

      violaciones.push({
        reglaId: 'any-type-explicito',
        mensaje: 'Tipo "any" explicito. Usar un tipo especifico o "unknown" si el tipo es desconocido.',
        severidad: obtenerSeveridadRegla('any-type-explicito'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Detecta uso excesivo de non-null assertions (!) en TypeScript.
 * Solo reporta si el archivo tiene 5 o mas instancias.
 */
export function verificarNonNullAssertion(texto: string, documento: vscode.TextDocument): Violacion[] {
  const lineas = texto.split('\n');
  const instancias: number[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const trimmed = linea.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
    if (linea.includes('sentinel-disable non-null-assertion-excesivo')) { continue; }
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line non-null-assertion-excesivo')) { continue; }

    const matches = [...linea.matchAll(/[)\]a-zA-Z0-9_>]!\s*[.\[]/g)];
    for (const match of matches) {
      const posExcl = (match.index ?? 0) + match[0].indexOf('!');
      if (posExcl + 1 < linea.length && linea[posExcl + 1] === '=') { continue; }
      if (posExcl > 0 && linea[posExcl - 1] === '!') { continue; }
      instancias.push(i);
    }
  }

  if (instancias.length < 5) { return []; }

  return instancias.map(lineaNum => ({
    reglaId: 'non-null-assertion-excesivo',
    mensaje: `Non-null assertion (!) — ${instancias.length} en este archivo. Indica tipos mal definidos. Tipar correctamente para evitar !.`,
    severidad: obtenerSeveridadRegla('non-null-assertion-excesivo'),
    linea: lineaNum,
    fuente: 'estatico' as const,
  }));
}

/* Escapa caracteres especiales para usar en regex */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
