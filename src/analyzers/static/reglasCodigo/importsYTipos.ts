/*
 * Reglas de imports muertos, any explicito y non-null assertion excesivo,
 * extraidas de staticCodeRules.ts. escapeRegex vive aqui: solo lo usa import-muerto.
 */

import { Violacion } from '../../../types';
import { CoreTextDocument } from '../../../core/runtime-proyecto/types';
import { enmascararLiterales, tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';

/* [124A-AUDIT1] Regex precompiladas para imports — antes se recreaban por cada línea del archivo */
const REGEX_IMPORT_NOMBRADO = /import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/;
const REGEX_IMPORT_DEFAULT = /^import\s+(?!type\s)(\w+)\s+from\s+['"][^'"]+['"]/;

/* Detecta imports sin uso en archivos JS/TS (heuristico simplificado) */
export function verificarImportsMuertos(
  texto: string,
  _documento: CoreTextDocument,
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

    /* [por que] Solo código: un import escrito dentro de una cadena (fixture) no es un import. */
    const codigo = enmascararLiterales(linea);

    /* Import nombrado: import { X, Y } from '...' */
    const matchNombrado = REGEX_IMPORT_NOMBRADO.exec(codigo);
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
    const matchDefault = REGEX_IMPORT_DEFAULT.exec(codigo);
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
export function verificarAnyType(texto: string, _documento: CoreTextDocument): Violacion[] {
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

    /* [por que] Un `: any` dentro de una cadena (fixture de test) no es un tipo. */
    if (/:\s*any\b|as\s+any\b/.test(enmascararLiterales(linea))) {
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
export function verificarNonNullAssertion(texto: string, _documento: CoreTextDocument): Violacion[] {
  /* Waiver de archivo, igual que el resto de detectores de este modulo. */
  if (tieneSentinelDisableFile(texto, 'non-null-assertion-excesivo')) { return []; }
  const lineas = texto.split('\n');
  const instancias: number[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const trimmed = linea.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
    if (linea.includes('sentinel-disable non-null-assertion-excesivo')) { continue; }
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line non-null-assertion-excesivo')) { continue; }

    const codigo = enmascararLiterales(linea); /* solo código: sin cadenas */
    const matches = [...codigo.matchAll(/[)\]a-zA-Z0-9_>]!\s*[.[]/g)];
    for (const match of matches) {
      const posExcl = (match.index ?? 0) + match[0].indexOf('!');
      if (posExcl + 1 < codigo.length && codigo[posExcl + 1] === '=') { continue; }
      if (posExcl > 0 && codigo[posExcl - 1] === '!') { continue; }
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
