/* Indexado de clases en JSX y en CSS del proyecto. Extraido de src/utils/analisisHelpers.ts (fachada). */
import { EnlaceClases, IndiceProyecto } from './indiceTipos';
import { RE_ATRIBUTO_OPERADO, RE_BLOQUE_CSS, RE_CLASSNAME_JSX, RE_MODAL_FUSIONA, RE_TAG_JSX, TAGS_CONTROL, prefijosDeClases } from './indiceEnlaces';
import { normalizarRuta } from './rutasYContenido';
import { VACIO } from './indiceAlias';
import * as fs from 'fs';

export function indexarJsx(ruta: string, indice: IndiceProyecto): void {
  let texto: string;
  try {
    texto = fs.readFileSync(ruta, 'utf8');
  } catch {
    return;
  }

  if (/[\\/]Modal\.(?:tsx|jsx)$/.test(ruta) && RE_MODAL_FUSIONA.some(re => re.test(texto))) {
    indice.modalFusionaClassName = true;
  }

  /* [15A-27] Los enlaces propios del fichero mandan; si no se declara aqui, se
   * sigue el `import` hasta el modulo que lo exporta. Lo que no se puede seguir
   * no aporta nada: antes se unia por nombre todo el proyecto, y eso contagiaba a
   * cada elemento las clases de cualquier fichero que usara el mismo nombre. */
  const clave = normalizarRuta(ruta);
  const propios = indice.enlacesPorFichero.get(clave);
  const origenes = indice.origenesPorFichero.get(clave);
  const resolver = (token: string): EnlaceClases => {
    const local = propios?.get(token);
    if (local) { return local; }

    const origen = origenes?.get(token);
    if (!origen) { return VACIO; }

    return indice.enlacesPorFichero.get(origen.modulo)?.get(origen.nombre) ?? VACIO;
  };

  RE_TAG_JSX.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = RE_TAG_JSX.exec(texto)) !== null) {
    const etiqueta = tag[1];
    const destino = /^[A-Z]/.test(etiqueta) ? indice.componente : indice.nativo;
    const esControl = TAGS_CONTROL.has(etiqueta);
    const seOpera = RE_ATRIBUTO_OPERADO.test(tag[2]);

    RE_CLASSNAME_JSX.lastIndex = 0;
    let atributo: RegExpExecArray | null;
    while ((atributo = RE_CLASSNAME_JSX.exec(tag[2])) !== null) {
      /* El valor puede ser un literal o una expresion (`clsx('x', cond && 'y')`):
       * se toman todos los identificadores con pinta de clase. Sobra alguna palabra
       * suelta, pero el veredicto queda del lado conservador. */
      const valor = atributo[1] ?? atributo[2] ?? atributo[3] ?? '';
      /* Los prefijos de plantilla viajan con el enlace: `botonFollow-` puede
       * estar escrito aqui o dentro del array al que apunta `clases`. */
      const prefijos = prefijosDeClases(valor);

      for (const token of valor.split(/[^A-Za-z0-9_-]+/)) {
        if (!token) { continue; }
        /* [15A-27] Si el token es un enlace (`clases`), valen tambien las clases
         * y los prefijos a los que apunta: estan aplicados a ESTE elemento
         * aunque no se escriban aqui. */
        const enlace = resolver(token);
        for (const clase of [token, ...enlace.clases]) {
          destino.add(clase);
          if (esControl) { indice.control.add(clase); }
          if (seOpera) { indice.operado.add(clase); }
        }
        prefijos.push(...enlace.prefijos);
      }

      /* [15A-27] Los prefijos van al cajon del elemento que los lleva: un
       * `` `botonFollow-${tamano}` `` sobre un <BotonBase> exime
       * `.botonFollow-sm`; el mismo literal sobre un <button> nativo, no. */
      for (const prefijo of prefijos) {
        if (destino === indice.componente) { indice.prefijosComponente.add(prefijo); }
        else { indice.prefijosNativo.add(prefijo); }
        if (esControl) { indice.prefijosControl.add(prefijo); }
        if (seOpera) { indice.prefijosOperado.add(prefijo); }
      }
    }
  }
}

export function indexarCss(ruta: string, indice: IndiceProyecto): void {
  let texto: string;
  try {
    texto = fs.readFileSync(ruta, 'utf8');
  } catch {
    return;
  }

  RE_BLOQUE_CSS.lastIndex = 0;
  let bloque: RegExpExecArray | null;
  while ((bloque = RE_BLOQUE_CSS.exec(texto)) !== null) {
    const selector = bloque[1].replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    if (!selector || selector.startsWith('@')) { continue; }

    for (const clase of new Set(Array.from(selector.matchAll(/\.([A-Za-z_][\w-]*)/g), grupo => grupo[1]))) {
      const cuerpos = indice.cuerposCss.get(clase) ?? [];
      cuerpos.push(bloque[2]);
      indice.cuerposCss.set(clase, cuerpos);
    }
  }
}
