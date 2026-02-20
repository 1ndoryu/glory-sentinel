/*
 * Motor de analisis estatico principal.
 * Ejecuta reglas basadas en regex contra el contenido del archivo.
 * Incluye logica para limites de lineas y conteo especial (useState).
 */

import * as vscode from 'vscode';
import { ReglaEstatica, Violacion } from '../types';
import { reglasEstaticas } from '../config/defaultRules';
import { contarLineasEfectivas, obtenerLimiteArchivo } from '../utils/lineCounter';

/*
 * Ejecuta todas las reglas estaticas aplicables a un documento.
 * Retorna un array de violaciones detectadas.
 */
export function analizarEstatico(
  documento: vscode.TextDocument,
  reglasPersonalizadas?: ReglaEstatica[]
): Violacion[] {
  const texto = documento.getText();
  const nombreArchivo = documento.fileName.split(/[/\\]/).pop() || '';
  const extension = '.' + nombreArchivo.split('.').pop();
  const violaciones: Violacion[] = [];

  const reglas = reglasPersonalizadas || reglasEstaticas;

  /* Ejecutar reglas regex por linea o por archivo completo */
  for (const regla of reglas) {
    if (!regla.aplicaA.some(ext => ext === extension || ext === 'todos')) {
      continue;
    }

    if (regla.porLinea) {
      const violacionesRegla = ejecutarReglaPorLinea(texto, regla, documento);
      violaciones.push(...violacionesRegla);
    } else {
      const violacionesRegla = ejecutarReglaCompleta(texto, regla, documento);
      violaciones.push(...violacionesRegla);
    }
  }

  /* Verificar limites de lineas (seccion 3 del protocolo) */
  const violacionesLimite = verificarLimiteLineas(documento, nombreArchivo);
  violaciones.push(...violacionesLimite);

  /* Verificar conteo de useState (regla compuesta, no simple regex por linea) */
  if (extension === '.tsx' || extension === '.jsx') {
    const violacionesUseState = verificarUseStateExcesivo(texto, documento);
    violaciones.push(...violacionesUseState);
  }

  /* Verificar imports muertos en JS/TS */
  if (['.ts', '.tsx', '.js', '.jsx'].includes(extension)) {
    const violacionesImports = verificarImportsMuertos(texto, documento);
    violaciones.push(...violacionesImports);
  }

  return violaciones;
}

/*
 * Ejecuta una regla regex linea por linea.
 * Aplica el patron a cada linea individual.
 */
function ejecutarReglaPorLinea(
  texto: string,
  regla: ReglaEstatica,
  documento: vscode.TextDocument
): Violacion[] {
  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Saltar lineas con comentario sentinel-disable */
    if (i > 0 && lineas[i - 1].includes(`sentinel-disable-next-line ${regla.id}`)) {
      continue;
    }
    if (linea.includes(`sentinel-disable ${regla.id}`)) {
      continue;
    }

    /* Resetear lastIndex para regex con flag g */
    const patron = new RegExp(regla.patron.source, regla.patron.flags.replace('g', ''));
    const match = patron.exec(linea);

    if (match) {
      /* Aplicar capturas al mensaje si existen */
      let mensaje = regla.mensaje;
      if (match[1]) {
        mensaje = mensaje.replace('$1', match[1]);
      }

      violaciones.push({
        reglaId: regla.id,
        mensaje,
        severidad: regla.severidad,
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        quickFixId: regla.quickFixId,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Ejecuta una regla regex contra el archivo completo.
 * Util para patrones multilinea como catch vacio.
 */
function ejecutarReglaCompleta(
  texto: string,
  regla: ReglaEstatica,
  documento: vscode.TextDocument
): Violacion[] {
  const violaciones: Violacion[] = [];
  const patron = new RegExp(regla.patron.source, regla.patron.flags + (regla.patron.flags.includes('g') ? '' : 'g'));

  let match: RegExpExecArray | null;
  while ((match = patron.exec(texto)) !== null) {
    const posicion = documento.positionAt(match.index);
    const posicionFin = documento.positionAt(match.index + match[0].length);

    /* Verificar sentinel-disable en la linea anterior */
    if (posicion.line > 0) {
      const lineaAnterior = documento.lineAt(posicion.line - 1).text;
      if (lineaAnterior.includes(`sentinel-disable-next-line ${regla.id}`)) {
        continue;
      }
    }

    let mensaje = regla.mensaje;
    if (match[1]) {
      mensaje = mensaje.replace('$1', match[1]);
    }

    violaciones.push({
      reglaId: regla.id,
      mensaje,
      severidad: regla.severidad,
      linea: posicion.line,
      lineaFin: posicionFin.line,
      columna: posicion.character,
      columnaFin: posicionFin.character,
      quickFixId: regla.quickFixId,
      fuente: 'estatico',
    });
  }

  return violaciones;
}

/* Verifica si el archivo excede los limites de lineas del protocolo */
function verificarLimiteLineas(
  documento: vscode.TextDocument,
  nombreArchivo: string
): Violacion[] {
  const limite = obtenerLimiteArchivo(nombreArchivo, documento.fileName);
  if (!limite) {
    return [];
  }

  const lineasEfectivas = contarLineasEfectivas(documento.getText());
  if (lineasEfectivas <= limite.limite) {
    return [];
  }

  /* Apuntar a la ultima linea del archivo para que el subrayado sea puntual
   * y no confunda al marcarse en la linea 1 (podria parecer error del encabezado). */
  const ultimaLinea = Math.max(0, documento.lineCount - 1);

  return [{
    reglaId: 'limite-lineas',
    mensaje: `Archivo excede limite de ${limite.limite} lineas para ${limite.tipo} (${lineasEfectivas} lineas efectivas). Dividir obligatoriamente.`,
    severidad: 'warning',
    linea: ultimaLinea,
    quickFixId: 'mark-split-todo',
    fuente: 'estatico',
  }];
}

/* Verifica si un componente React tiene mas de 3 useState */
function verificarUseStateExcesivo(
  texto: string,
  documento: vscode.TextDocument
): Violacion[] {
  const matches = texto.match(/\buseState\s*[<(]/g);
  if (!matches || matches.length <= 3) {
    return [];
  }

  return [{
    reglaId: 'usestate-excesivo',
    mensaje: `${matches.length} useState detectados (max 3). Extraer logica a un hook personalizado.`,
    severidad: 'warning',
    linea: 0,
    quickFixId: 'extract-to-hook',
    fuente: 'estatico',
  }];
}

/* Detecta imports sin uso en archivos JS/TS (heuristico simplificado) */
function verificarImportsMuertos(
  texto: string,
  documento: vscode.TextDocument
): Violacion[] {
  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* Saltar lineas que son comentarios para evitar falsos positivos.
     * Sin esto, un ejemplo de import dentro de un comentario se parsea
     * como import real y genera falsos positivos de import-muerto. */
    const lineaTrimmed = linea.trim();
    if (
      lineaTrimmed.startsWith('//') ||
      lineaTrimmed.startsWith('*') ||
      lineaTrimmed.startsWith('/*')
    ) {
      continue;
    }

    /* Import nombrado: import { X, Y } from '...' */
    const matchNombrado = /import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/.exec(linea);
    if (matchNombrado) {
      const nombres = matchNombrado[1]
        .split(',')
        .map(n => {
          /* Strip prefijo 'type' de imports como: { type DiaSemana, type Foo } */
          const limpio = n.trim().replace(/^type\s+/, '');
          return limpio.split(' as ').pop()?.trim();
        })
        .filter(Boolean) as string[];
      const restoTexto = texto.substring(texto.indexOf('\n', texto.indexOf(linea)) + 1);

      for (const nombre of nombres) {
        /* Buscar uso del nombre importado en el resto del archivo */
        const regexUso = new RegExp(`\\b${escapeRegex(nombre)}\\b`);
        if (!regexUso.test(restoTexto)) {
          violaciones.push({
            reglaId: 'import-muerto',
            mensaje: `Import "${nombre}" no se usa en el archivo. Eliminar.`,
            severidad: 'warning',
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
          severidad: 'warning',
          linea: i,
          quickFixId: 'remove-dead-import',
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/* Escapa caracteres especiales para usar en regex */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
