/* Reglas CSS de estilos ad-hoc: variantes *CardIcono y botones fuera del sistema Button. Extraido de staticCssRules.ts. */
import { Violacion } from '../../types';
import { CoreTextDocument } from '../../core/runtime-proyecto/types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { rutaExentaPorProyecto } from '../../config/exencionesProyecto';
import { AjustesProyecto, AJUSTES_PROYECTO_DEFECTO } from '../ajustesProyecto';
import {
  claseAplicada,
  indiceProyecto,
  tieneSentinelDisable,
  tieneSentinelDisableFile,
} from '../../utils/analisisHelpers';
import { CLASES_BOTON_SISTEMA } from './staticCssDesignRules';

/*
 * Detecta variantes *CardIcono que redefinen la receta base de .panelCardIcono.
 * La clase variante debe usarse solo para overrides puntuales y no recrear
 * display/alineacion/flex-shrink desde cero.
 */
export function verificarCardIconoExtiendeBase(
  texto: string,
  documento: CoreTextDocument,
  nombreArchivo: string,
): Violacion[] {
  const rutaNorm = documento.fileName.replace(/\\/g, '/');
  if (rutaNorm.includes('node_modules') || rutaNorm.includes('vendor')) {
    return [];
  }

  const nombreLower = nombreArchivo.toLowerCase();
  if (nombreLower === 'panelisland.css' || nombreLower === 'panelisland.scss') {
    return [];
  }

  if (tieneSentinelDisableFile(texto, 'card-icono-debe-extender-base')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const lineas = texto.split('\n');
  const regexSelector = /^\.([A-Za-z][\w-]*CardIcono)\s*\{/;
  const regexPropiedadBase = /^(display\s*:\s*flex|align-items\s*:\s*center|justify-content\s*:\s*center|flex-shrink\s*:\s*0)\b/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    if (linea.startsWith('/*') || linea.startsWith('*') || linea.startsWith('//')) { continue; }

    const match = regexSelector.exec(linea);
    if (!match) { continue; }

    const nombreClase = match[1];
    if (nombreClase === 'panelCardIcono') { continue; }
    /* [25A-SENT-FP] Usa tieneSentinelDisable para soportar disable comments multi-linea */
    if (tieneSentinelDisable(lineas, i, 'card-icono-debe-extender-base')) { continue; }

    let redefineBase = false;
    for (let j = i + 1; j < lineas.length; j++) {
      const lineaBloque = lineas[j].trim();
      if (lineaBloque.startsWith('/*') || lineaBloque.startsWith('*') || lineaBloque.startsWith('//')) { continue; }
      if (lineaBloque.includes('}')) { break; }
      if (regexPropiedadBase.test(lineaBloque)) {
        redefineBase = true;
        break;
      }
    }

    if (!redefineBase) { continue; }

    violaciones.push({
      reglaId: 'card-icono-debe-extender-base',
      mensaje: `La clase CSS ".${nombreClase}" redefine la base compartida de card icon. Usa .panelCardIcono en JSX y deja aqui solo overrides puntuales.`,
      severidad: obtenerSeveridadRegla('card-icono-debe-extender-base'),
      linea: i,
      fuente: 'estatico',
    });
  }

  return violaciones;
}

/* [104A-11]
 * Detecta estilos CSS de botones ad-hoc fuera del sistema Button.
 * A diferencia de la regex plana, esta version:
 * - ignora comentarios con la palabra boton/button
 * - ignora selectores nativos tipo button.tarjetaBase
 * - ignora clases base del sistema (menuContextualBoton, botonBase, etc.)
 * - ignora assets legacy y glory-rs, donde el sistema define sus propios estilos
 */
export function verificarCssAdhocButtonStyle(
  texto: string,
  documento: CoreTextDocument,
  nombreArchivo: string,
  /* [15A-25] El caller (staticAnalyzer) pasa las roots del proyecto para poder
   * mirar a que elemento se aplica la clase. Sin roots el indice sale vacio y la
   * regla dispara como antes: fail-closed, la falta de evidencia no exime. */
  roots: string[] = [],
  /* Las exenciones del proyecto llegan por parámetro: sin estado de módulo entre proyectos. */
  ajustes: AjustesProyecto = AJUSTES_PROYECTO_DEFECTO,
): Violacion[] {
  const nombreLower = nombreArchivo.toLowerCase();
  const rutaNorm = documento.fileName.replace(/\\/g, '/');

  if (nombreLower === 'button.css' || nombreLower === 'variables.css') {
    return [];
  }

  if (rutaNorm.includes('/node_modules/') || rutaNorm.includes('/vendor/') || rutaExentaPorProyecto(rutaNorm, ajustes.exenciones)) {
    return [];
  }

  if (tieneSentinelDisableFile(texto, 'css-adhoc-button-style')) {
    return [];
  }

  const aplicadas = indiceProyecto(roots);
  const violaciones: Violacion[] = [];
  const regexBloques = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regexBloques.exec(texto)) !== null) {
    const selectorRaw = match[1];
    const cuerpo = match[2];
    const selector = selectorRaw.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();

    if (!selector || selector.startsWith('@')) {
      continue;
    }

    if (!/cursor\s*:\s*pointer/i.test(cuerpo)) {
      continue;
    }

    const clasesSelector = Array.from(selector.matchAll(/[.#]([A-Za-z_][\w-]*)/g)).map(grupo => grupo[1]);
    if (clasesSelector.length === 0) {
      continue;
    }

    /* [15A-27] Un bloque que compone con una clase base del sistema
     * (`.botonBase.pageBuilderTipoBoton`) hereda esa base: es una variante, no
     * un boton hecho a mano. El filtro de abajo solo mira el nombre
     * problematico, asi que el mismo patron salia o no salia segun si el
     * modificador contenia 'boton': `.botonBase.controlBloque` no se reportaba
     * y `.botonBase.pageBuilderTipoBoton` si, con el mismo cuerpo. */
    if (clasesSelector.some(nombreClase => CLASES_BOTON_SISTEMA.has(nombreClase))) {
      continue;
    }

    const claseProblematica = clasesSelector.find(nombreClase => {
      if (!/(?:boton|button)/i.test(nombreClase)) {
        return false;
      }

      return !CLASES_BOTON_SISTEMA.has(nombreClase);
    });

    if (!claseProblematica) {
      continue;
    }

    /* [15A-25] El veredicto lo da el elemento que lleva la clase, no el CSS. Si la
     * clase se aplica a un componente y a ningun elemento nativo, es una variante
     * del boton del sistema (su className viaja al <BotonBase>), no un boton hecho
     * a mano. Un bloque CSS no puede ser un boton por si mismo. */
    if (claseAplicada(claseProblematica, aplicadas.componente, aplicadas.prefijosComponente)
        && !claseAplicada(claseProblematica, aplicadas.nativo, aplicadas.prefijosNativo)) {
      continue;
    }

    const linea = texto.slice(0, match.index).split('\n').length - 1;
    violaciones.push({
      reglaId: 'css-adhoc-button-style',
      mensaje: 'Bloque CSS de boton detectado fuera de Button.css. Si es un boton, usar <Button variante="..."> en su lugar.',
      severidad: obtenerSeveridadRegla('css-adhoc-button-style'),
      linea,
      fuente: 'estatico',
    });
  }

  return violaciones;
}
