/*
 * Motor de analisis estatico principal.
 * Ejecuta reglas basadas en regex contra el contenido del archivo.
 * Incluye logica para limites de lineas y conteo especial (useState).
 */

import * as vscode from 'vscode';
import { ReglaEstatica, Violacion } from '../types';
import { reglasEstaticas } from '../config/defaultRules';
import { contarLineasEfectivas, obtenerLimiteArchivo } from '../utils/lineCounter';
import { reglaHabilitada, obtenerSeveridadRegla } from '../config/ruleRegistry';

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

  /* Excluir prototipos de referencia — no son codigo de produccion */
  const nombreBase = nombreArchivo.replace(/\.[^.]+$/, '');
  if (nombreBase === 'ejemplo' || nombreBase === 'example') {
    return violaciones;
  }

  const reglas = reglasPersonalizadas || reglasEstaticas;

  /* Ejecutar reglas regex por linea o por archivo completo.
   * Filtra reglas deshabilitadas via codeSentinel.rules en settings.json. */
  for (const regla of reglas) {
    if (!reglaHabilitada(regla.id)) {
      continue;
    }

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
  if (reglaHabilitada('limite-lineas')) {
    const violacionesLimite = verificarLimiteLineas(documento, nombreArchivo);
    violaciones.push(...violacionesLimite);
  }

  /* Verificar conteo de useState (regla compuesta, no simple regex por linea).
   * Excluir archivos de hooks (use*.ts/tsx) — los hooks SON el destino de la extraccion,
   * pedirles "extraer a hook" es un falso positivo circular. */
  const esArchivoHook = /^use[A-Z]/.test(nombreArchivo);
  if ((extension === '.tsx' || extension === '.jsx') && !esArchivoHook && reglaHabilitada('usestate-excesivo')) {
    const violacionesUseState = verificarUseStateExcesivo(texto, documento);
    violaciones.push(...violacionesUseState);
  }

  /* Verificar imports muertos en JS/TS */
  if (['.ts', '.tsx', '.js', '.jsx'].includes(extension) && reglaHabilitada('import-muerto')) {
    const violacionesImports = verificarImportsMuertos(texto, documento);
    violaciones.push(...violacionesImports);
  }

  /* Sprint 2: any-type-explicito en TS/TSX */
  if (['.ts', '.tsx'].includes(extension) && !nombreArchivo.endsWith('.d.ts') && reglaHabilitada('any-type-explicito')) {
    violaciones.push(...verificarAnyType(texto, documento));
  }

  /* Sprint 3: Reglas CSS */
  if (['.css', '.scss'].includes(extension)) {
    if (reglaHabilitada('nomenclatura-css-ingles')) {
      violaciones.push(...verificarNomenclaturaCssIngles(texto, documento, nombreArchivo));
    }
    /* css-hardcoded-value: desactivada por decision de producto.
     * Demasiados falsos positivos en variables CSS con valores literales validos.
     * Re-activar cambiando este bloque cuando se refine la heuristica. */
    // if (reglaHabilitada('css-hardcoded-value')) {
    //   violaciones.push(...verificarCssHardcoded(texto, documento, nombreArchivo));
    // }
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

    /* Saltar lineas dentro de doc comments PHP para reglas que buscan codigo,
     * no comentarios. Evita falsos positivos como @author matcheando at-generico-php */
    if (regla.id === 'at-generico-php') {
      const lineaTrimmed = linea.trim();
      if (lineaTrimmed.startsWith('*') || lineaTrimmed.startsWith('/**') || lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('#')) {
        continue;
      }
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
        severidad: obtenerSeveridadRegla(regla.id),
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
      severidad: obtenerSeveridadRegla(regla.id),
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

/* Verifica si el archivo excede los limites de lineas del protocolo.
 * Soporta excepciones a nivel de archivo con sentinel-disable-file limite-lineas */
function verificarLimiteLineas(
  documento: vscode.TextDocument,
  nombreArchivo: string
): Violacion[] {
  const texto = documento.getText();

  /* Permitir excepciones documentadas a nivel de archivo.
   * El comentario debe incluir justificacion para evitar abusos. */
  if (texto.includes('sentinel-disable-file limite-lineas')) {
    return [];
  }

  const limite = obtenerLimiteArchivo(nombreArchivo, documento.fileName);
  if (!limite) {
    return [];
  }

  const lineasEfectivas = contarLineasEfectivas(texto);
  if (lineasEfectivas <= limite.limite) {
    return [];
  }

  /* Apuntar a la ultima linea del archivo para que el subrayado sea puntual
   * y no confunda al marcarse en la linea 1 (podria parecer error del encabezado). */
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
    severidad: obtenerSeveridadRegla('usestate-excesivo'),
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

/* Escapa caracteres especiales para usar en regex */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* =======================================================================
 * SPRINT 2 — any-type-explicito
 * Detecta uso de `: any` o `as any` en archivos TS/TSX.
 * ======================================================================= */

function verificarAnyType(texto: string, documento: vscode.TextDocument): Violacion[] {
  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaTrimmed = linea.trim();

    /* Saltar comentarios */
    if (lineaTrimmed.startsWith('//') || lineaTrimmed.startsWith('*') ||
        lineaTrimmed.startsWith('/*') || lineaTrimmed.startsWith('#')) {
      continue;
    }

    /* Saltar sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line any-type-explicito')) {
      continue;
    }
    if (linea.includes('sentinel-disable any-type-explicito')) {
      continue;
    }

    /* Detectar : any o as any (palabra completa, no 'analyze' etc.) */
    if (/:\s*any\b|as\s+any\b/.test(linea)) {
      /* Excluir lineas que son eslint-disable o type comments de tools */
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

/* =======================================================================
 * SPRINT 3 — nomenclatura-css-ingles
 * Detecta clases CSS con nombres en ingles. El protocolo requiere espanol.
 * ======================================================================= */

function verificarNomenclaturaCssIngles(
  texto: string,
  documento: vscode.TextDocument,
  nombreArchivo: string
): Violacion[] {
  /* Excluir archivos de librerias */
  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  if (rutaNorm.includes('node_modules') || rutaNorm.includes('vendor') ||
      rutaNorm.includes('shadcn') || rutaNorm.includes('tailwind')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');

  /* Diccionario de palabras inglesas muy comunes en selectores CSS.
   * Solo se detectan como clase CSS (precedidas de . en selector). */
  const regexIngles = /\.(main|container|wrapper|button|header|footer|sidebar|content|card|item|input|form|modal|dropdown|toggle|badge|alert|tooltip|carousel|slider|pagination|breadcrumb|accordion|spinner|loader|overlay|backdrop|divider|grid|column|flex|stack|box|title|subtitle|heading|label|caption|description|link|icon|avatar|thumbnail|table|checkbox|radio|select|textarea|switch|progress|dialog|drawer|menu|toolbar|tag|chip|step|timeline|tree|upload|download|search|filter|sort|block|hidden|visible|active|disabled|selected|focused|checked|primary|secondary|dark|light|small|medium|large)\b/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    /* Saltar comentarios */
    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) {
      continue;
    }

    /* Saltar sentinel-disable */
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line nomenclatura-css-ingles')) {
      continue;
    }

    const match = regexIngles.exec(linea);
    if (match) {
      violaciones.push({
        reglaId: 'nomenclatura-css-ingles',
        mensaje: `Clase CSS en ingles ".${match[1]}". El protocolo requiere nombres en espanol (ej: .contenedor, .boton).`,
        severidad: obtenerSeveridadRegla('nomenclatura-css-ingles'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* =======================================================================
 * SPRINT 3 — css-hardcoded-value
 * Detecta colores y valores hardcodeados en CSS que deberian usar variables.
 * ======================================================================= */

function verificarCssHardcoded(
  texto: string,
  documento: vscode.TextDocument,
  nombreArchivo: string
): Violacion[] {
  /* Excluir archivos de definicion de variables */
  const nombreLower = nombreArchivo.toLowerCase();
  if (/variables\.css|init\.css|theme\.css|tokens\.css/.test(nombreLower)) {
    return [];
  }

  /* Excluir librerias */
  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  if (rutaNorm.includes('node_modules') || rutaNorm.includes('vendor')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');
  let dentroRoot = false;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    /* Saltar comentarios */
    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) {
      continue;
    }

    /* Saltar sentinel-disable */
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line css-hardcoded-value')) {
      continue;
    }

    /* Rastrear bloque :root (definiciones de variables son aceptables) */
    if (/:root\s*\{/.test(linea)) { dentroRoot = true; }
    if (dentroRoot && /\}/.test(linea)) { dentroRoot = false; }
    if (dentroRoot) { continue; }

    /* Saltar definiciones de variables CSS (--variable: valor) */
    if (/^\s*--/.test(lineas[i])) { continue; }

    /* Saltar lineas que ya usan var() */
    if (/var\s*\(/.test(linea)) { continue; }

    /* Detectar colores hex: #fff, #ffffff, #ffffffaa */
    if (/#[0-9a-fA-F]{3,8}\b/.test(linea)) {
      /* Excluir comentarios inline */
      const antesHash = linea.indexOf('#');
      const antesComentario = linea.indexOf('//');
      if (antesComentario >= 0 && antesComentario < antesHash) { continue; }

      violaciones.push({
        reglaId: 'css-hardcoded-value',
        mensaje: 'Color hex hardcodeado. Usar variable CSS: var(--color-nombre).',
        severidad: obtenerSeveridadRegla('css-hardcoded-value'),
        linea: i,
        fuente: 'estatico',
      });
      continue;
    }

    /* Detectar rgb/rgba/hsl/hsla */
    if (/\b(rgba?|hsla?)\s*\(/.test(linea)) {
      violaciones.push({
        reglaId: 'css-hardcoded-value',
        mensaje: 'Color rgb/hsl hardcodeado. Usar variable CSS: var(--color-nombre).',
        severidad: obtenerSeveridadRegla('css-hardcoded-value'),
        linea: i,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
