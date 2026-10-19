/*
 * Reglas de estructura de componentes: key={index} en listas y logica excesiva
 * que debe ir a un hook. Ambas miran como se organiza un componente, no el DS.
 */

import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable, tieneSentinelDisableFile } from '../../../utils/analisisHelpers';

/*
 * Detecta key={index} en callbacks de .map().
 * Usar el indice como key causa reconciliacion incorrecta cuando items
 * se agregan, eliminan o reordenan. Usar un ID unico del item.
 */
export function verificarKeyIndexLista(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  /* [259A-5] Contrato disable uniforme: file-level + next-line. */
  const textoPrevio = lineas.join('\n');
  if (tieneSentinelDisableFile(textoPrevio, 'key-index-lista')) { return []; }

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

  /* [08AA-26] Receptores derivados de string (`const xs = s.split(..)`):
   * lista contenido-derivada, sin reordenamientos ni filtros: el indice es
   * estable por construccion (misma cadena -> mismos fragmentos) y no hay
   * identidad estable que usar como key. Caso MN `message-media.tsx`
   * (`body.split('\n')`) 2026-10-08. NO exime `filter` inline sobre datos
   * dinamicos: ahi el indice sigue siendo fragil y se sigue marcando. */
  const regexSplit = /(?:const|let|var)\s+(\w+)\s*=\s*[^;]*?\.split\s*\(/g;
  let mSplit: RegExpExecArray | null;
  while ((mSplit = regexSplit.exec(textoCompleto)) !== null) {
    if (mSplit[1]) { slotsFijos.add(mSplit[1]); }
  }

  let dentroDeMap = false;
  let profundidadMap = 0;
  let receptorEsFijo = false;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* [259A-5] next-line (el disable puede quedar sobre el .map contenedor). */
    if (tieneSentinelDisable(lineas, i, 'key-index-lista')) { continue; }

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

  /* [104A-4] Soporte sentinel-disable-file para esta regla.
   * [259A-5] Match por token exacto (ambas grafias en uso: `componente-sin-hook`
   * historica y `componente-sin-hook-glory` actual): ninguna exime a otra regla,
   * ambas eximen a esta. */
  const texto = lineas.join('\n');
  if (tieneSentinelDisableFile(texto, 'componente-sin-hook-glory') ||
      tieneSentinelDisableFile(texto, 'componente-sin-hook')) { return []; }

  const nombreComponente = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  /* [08AA-26] Archivo kebab-case (chats-marketplace.tsx) → hook useChatsMarketplace. */
  const nombrePascal = nombreComponente.split(/[-_]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  const regexHookDedicado = new RegExp(`\\buse(?:${nombreComponente}|${nombrePascal})\\b`);
  const tieneHookDedicado = lineas.some(l => regexHookDedicado.test(l));
  if (tieneHookDedicado) { return []; }

  const violaciones: Violacion[] = [];

  let finImports = 0;
  for (let i = 0; i < lineas.length; i++) {
    if (/^import\s/.test(lineas[i].trim())) { finImports = i + 1; }
  }

  /* [08AA-26] La logica del componente empieza en su declaracion PascalCase, no tras los
   * imports: las funciones auxiliares de modulo (fechaCorta, textoUsos...) con if/await no
   * son logica del componente. `[A-Z][a-z]` excluye constantes tipo TABS_MARKETPLACE. Sin
   * declaracion detectable, se mantiene el comportamiento previo (desde los imports). */
  let inicio = finImports;
  for (let i = finImports; i < lineas.length; i++) {
    if (/^(?:export\s+)?(?:default\s+)?(?:function|const)\s+[A-Z][a-z]\w*/.test(lineas[i].trim())) {
      inicio = i;
      break;
    }
  }

  let lineaReturn = -1;
  for (let i = inicio; i < lineas.length; i++) {
    if (/\breturn\s*\(\s*$|\breturn\s*</.test(lineas[i].trim())) {
      lineaReturn = i;
      break;
    }
  }

  if (lineaReturn < inicio) { return violaciones; }

  let lineasLogicaTotal = 0;
  let lineasLogicaEstado = 0;
  const regexLogicaTotal = /\b(useEffect|useState|useMemo|useCallback|useRef|fetch\s*\(|await\s|try\s*\{|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|\.then\s*\()/;
  const regexLogicaEstado = /\b(useEffect|useState|useMemo|useCallback|useRef|fetch\s*\(|await\s|\.then\s*\()/;

  for (let i = inicio; i < lineaReturn; i++) {
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
    /* [259A-5] next-line: el disable queda sobre el cuerpo del componente. */
    if (tieneSentinelDisable(lineas, finImports, 'componente-sin-hook-glory') ||
        tieneSentinelDisable(lineas, finImports, 'componente-sin-hook')) { return []; }
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
