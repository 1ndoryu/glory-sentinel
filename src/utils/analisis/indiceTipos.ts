/* Tipos del indice de clases del proyecto. Extraido de src/utils/analisisHelpers.ts (fachada). */
/* [15A-25] Varias reglas emitian veredictos que el CSS por si solo no puede sostener:
 * `css-adhoc-button-style` marcaba como boton hecho a mano cualquier bloque con
 * `cursor: pointer` y una clase `*boton*`, cuando en KAMPLES los 31 bloques son
 * variantes aplicadas a <BotonBase>; `modal-acciones-no-canonico` marcaba cualquier
 * clase `*Acciones` dentro de un <Modal>, cuando tres de las cuatro no son la zona
 * de botones sino una barra de cabecera o un pie con borde propio; y
 * `modal-estructura-no-canonica` avisaba de que una className "redefine el
 * contenedor" cuando <Modal> la APPENDEA a las suyas.
 *
 * Un unico recorrido del proyecto (JSX y CSS) construye el indice que necesitan, con
 * cache por conjunto de roots. Un solo recorrido porque cada regla hace su propia
 * pregunta sobre el mismo material. */
export interface IndiceProyecto {
  /* Clases aplicadas a un COMPONENTE (<BotonBase ... className=...>). */
  componente: Set<string>;
  /* Clases aplicadas a un elemento NATIVO (<button ...>). */
  nativo: Set<string>;
  /* [15A-26] Subconjunto de `nativo`: clases aplicadas a un CONTROL
   * (<button>, <a>, <input>, <select>, <textarea>, <summary>). La regla
   * `css-especificacion-diseno-local` prescribe "usa una receta compartida como
   * Button": eso solo es aplicable donde hay un control. */
  control: Set<string>;
  /* [15A-26] Clases aplicadas a un elemento que SE OPERA: lleva un manejador `on*`
   * o declara un rol interactivo. Un `<div onClick>` es un boton de facto y la
   * receta si aplica. */
  operado: Set<string>;
  /* Cuerpo de cada bloque CSS, por clase: una clase puede definirse en varias hojas. */
  cuerposCss: Map<string, string[]>;
  /* El <Modal> del proyecto fusiona la className recibida con las suyas. */
  modalFusionaClassName: boolean;
  /* [15A-27] Fichero -> (identificador -> fragmentos de clase), para las clases
   * que NO se escriben como literal en el `className` sino que se arman antes:
   * `const clases = ['botonLike', ...]`, o el array que devuelve un hook en un
   * `.ts` (`useBotonFollow.ts:51` -> `clases`). Sin esto la clase quedaba
   * invisible para el indice y la regla no podia ver sobre que elemento se
   * aplica. Las claves son rutas normalizadas a `/`. */
  enlacesPorFichero: Map<string, Map<string, EnlaceClases>>;
  /* [15A-27] Fichero -> (identificador -> modulo y nombre del que procede), para
   * los enlaces que NO se declaran en el propio fichero sino que entran por un
   * `import`. Es la sustitucion de la union por nombre que habia antes: unir
   * TODOS los ficheros por identificador parecia inofensivo hasta que el nombre
   * repetido fue `clases` —el mas comun del proyecto—, y entonces cada elemento
   * con `className={clases}` arrastraba las clases de los demas ficheros. Asi
   * `.botonFollow` acababa contada como aplicada a un <button> nativo que nunca
   * la llevo, y la exencion de `css-adhoc-button-style` moria. */
  origenesPorFichero: Map<string, Map<string, OrigenEnlace>>;
  /* [15A-27] Prefijos de clase que el JSX arma con plantilla:
   * `` `botonFollow-${tamano}` `` produce `.botonFollow-sm` o `.botonFollow-md`
   * segun el valor, que no esta en el literal. El sufijo es dinamico y no se
   * puede enumerar, pero el prefijo si es literal, asi que la clase cuenta como
   * aplicada si empieza por el. Uno por cajon: el prefijo solo exime donde el
   * elemento que lo lleva es de ese tipo. */
  prefijosComponente: Set<string>;
  prefijosNativo: Set<string>;
  prefijosControl: Set<string>;
  prefijosOperado: Set<string>;
}

/* [15A-27] Lo que un enlace (`const clases = ...`) aporta: las clases literales
 * y los prefijos de las plantillas que arma. */
export interface EnlaceClases {
  clases: string[];
  prefijos: string[];
}

/* [15A-27] De donde viene un identificador que el fichero NO declara: el modulo
 * que lo exporta y el nombre que tiene alli. */
export interface OrigenEnlace {
  modulo: string;
  nombre: string;
}

/* [15A-27] Alias de importacion del proyecto (`@app/*` -> `frontend/src/legacy/*`,
 * declarados en los tsconfig). Sin seguirlos, un
 * `import { useBotonFollow } from '@app/hooks/boton/useBotonFollow'` no lleva a
 * ninguna parte y el enlace que el hook devuelve queda invisible. */
export interface AliasModulo {
  prefijo: string;
  base: string;
}
