/*
 * [15A-25] Regresiones de las reglas que dejaron de juzgar por el nombre y pasaron a
 * mirar la forma: `css-adhoc-button-style` pregunta a que elemento se aplica la clase,
 * `modal-acciones-no-canonico` pide el bloque CSS de la clase, y
 * `modal-estructura-no-canonica` comprueba si el <Modal> del proyecto fusiona la
 * className recibida. Las tres necesitan un proyecto de verdad en disco.
 * `css-elemento-html-directo` reconoce la superficie de contenido por su estructura,
 * asi que solo necesita la hoja.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { verificarCssAdhocButtonStyle, verificarCssElementoHTMLDirecto } from '../../analyzers/static/staticCssRules';
import { verificarModalAccionesNoCanonico, verificarModalEstructuraNoCanonica } from '../../analyzers/react/reactComponentRules';
import { indiceProyecto } from '../../utils/analisisHelpers';

let contador = 0;

/* Cada proyecto va a su propio directorio: el indice se cachea por conjunto de
 * roots, asi que compartir ruta entre tests devolveria el indice del primero. */
function crearProyecto(archivos: Record<string, string>): string {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), `sentinel-indice-${contador++}-`));
  for (const [relativa, contenido] of Object.entries(archivos)) {
    const destino = path.join(raiz, relativa);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido, 'utf8');
  }
  return raiz;
}

function crearDocumento(fileName: string) {
  return { fileName } as any;
}

suite('css-adhoc-button-style — veredicto por elemento', () => {
  test('la clase aplicada a un componente del sistema no es un boton hecho a mano', () => {
    const raiz = crearProyecto({
      'src/boton/BotonFollow.tsx': [
        'export function BotonFollow() {',
        '  return <BotonBase className="botonFollow" onClick={manejar}>Seguir</BotonBase>;',
        '}',
      ].join('\n'),
    });
    const texto = '.botonFollow { cursor: pointer; padding: 4px 12px; }';
    const violaciones = verificarCssAdhocButtonStyle(
      texto,
      crearDocumento(path.join(raiz, 'src/boton/BotonFollow.css')),
      'BotonFollow.css',
      [raiz],
    );

    assert.strictEqual(violaciones.length, 0);
  });

  test('la misma clase sobre un <button> nativo si es un boton hecho a mano', () => {
    const raiz = crearProyecto({
      'src/panel/Filtro.tsx': '<button className="filtroColumnaBoton" onClick={aplicar}>Filtrar</button>',
    });
    const texto = '.filtroColumnaBoton { cursor: pointer; padding: 4px 12px; }';
    const violaciones = verificarCssAdhocButtonStyle(
      texto,
      crearDocumento(path.join(raiz, 'src/panel/Filtro.css')),
      'Filtro.css',
      [raiz],
    );

    assert.strictEqual(violaciones.length, 1);
  });

  /* [15A-27] Dos de los 41 hallazgos de KAMPLES eran este caso: la clase no se
   * escribe en el `className`, se arma antes en un array (`const clases = [...]`),
   * a veces en un `.ts` sin JSX —el hook que la devuelve—. El indice solo miraba
   * el literal del `className`, asi que la clase quedaba invisible y el elemento
   * parecia no tenerla. */
  test('[15A-27] la clase armada en un array del propio fichero cuenta', () => {
    const raiz = crearProyecto({
      'src/boton/BotonLike.tsx': [
        'export function BotonLike() {',
        "  const clases = ['botonLike', liked ? 'botonLikeActivo' : '', className].filter(Boolean).join(' ');",
        '  return <BotonBase className={clases} onClick={alternar}>Like</BotonBase>;',
        '}',
      ].join('\n'),
    });
    const violaciones = verificarCssAdhocButtonStyle(
      '.botonLike { cursor: pointer; padding: 4px 12px; }',
      crearDocumento(path.join(raiz, 'src/boton/BotonLike.css')),
      'BotonLike.css',
      [raiz],
    );

    assert.strictEqual(violaciones.length, 0);
  });

  test('[15A-27] la clase que devuelve un hook en un .ts tambien cuenta', () => {
    const raiz = crearProyecto({
      'src/boton/useBotonFollow.ts': [
        'export function useBotonFollow(siguiendo: boolean) {',
        "  const clases = ['botonFollow', siguiendo ? 'botonFollowActivo' : ''].filter(Boolean).join(' ');",
        '  return { clases };',
        '}',
      ].join('\n'),
      'src/boton/BotonFollow.tsx': [
        'export function BotonFollow() {',
        '  const { clases } = useBotonFollow(siguiendo);',
        '  return <BotonBase variante="ghost" className={`${clases} botonFollowIcono`} onClick={seguir}>Seguir</BotonBase>;',
        '}',
      ].join('\n'),
    });
    const violaciones = verificarCssAdhocButtonStyle(
      '.botonFollow { cursor: pointer; padding: 4px 12px; }',
      crearDocumento(path.join(raiz, 'src/boton/BotonFollow.css')),
      'BotonFollow.css',
      [raiz],
    );

    assert.strictEqual(violaciones.length, 0);
  });

  test('[15A-27] testigo: un identificador repetido no arrastra las clases de otro fichero', () => {
    /* `clases` es el nombre de variable de medio centenar de ficheros. Si el
     * enlace del propio fichero no mandase sobre la union del proyecto, la clase
     * de otro fichero eximiria a esta sin que nadie la aplique. */
    const raiz = crearProyecto({
      'src/otro/useOtraCosa.ts': "const clases = ['botonLike', 'botonLikeActivo'];",
      'src/panel/Panel.tsx': [
        'export function Panel() {',
        "  const clases = ['panelBotonPropio'];",
        '  return <button className={clases} onClick={abrir}>Abrir</button>;',
        '}',
      ].join('\n'),
    });
    const violaciones = verificarCssAdhocButtonStyle(
      '.botonLike { cursor: pointer; padding: 4px 12px; }',
      crearDocumento(path.join(raiz, 'src/panel/Panel.css')),
      'Panel.css',
      [raiz],
    );

    assert.strictEqual(violaciones.length, 1);
  });

  test('sin roots conserva el veredicto anterior (fail-closed)', () => {
    const texto = '.botonFollow { cursor: pointer; }';
    const violaciones = verificarCssAdhocButtonStyle(
      texto,
      crearDocumento('/repo/frontend/src/components/ui/Boton.css'),
      'Boton.css',
    );

    assert.strictEqual(violaciones.length, 1);
  });
});

suite('modal-acciones-no-canonico — veredicto por bloque CSS', () => {
  const modal = '<Modal abierto={abierto} onCerrar={onCerrar}>';

  test('un pie que declara layout propio no duplica la receta', () => {
    const raiz = crearProyecto({
      'src/modal/Config.css': '.configAcciones { display: flex; justify-content: flex-end; gap: var(--espacioSm); padding: var(--espacioMd); border-top: 1px solid var(--bordeSutil); }',
    });
    const violaciones = verificarModalAccionesNoCanonico(
      [modal, '<div className="configAcciones">'],
      [raiz],
    );

    assert.strictEqual(violaciones.length, 0);
  });

  test('un duplicado literal de la receta si es un hallazgo', () => {
    const raiz = crearProyecto({
      'src/modal/Timing.css': '.algoTimingAcciones { display: flex; gap: var(--espacioSm); }',
    });
    const violaciones = verificarModalAccionesNoCanonico(
      [modal, '<div className="algoTimingAcciones">'],
      [raiz],
    );

    assert.strictEqual(violaciones.length, 1);
    assert.match(violaciones[0]?.mensaje || '', /algoTimingAcciones/);
  });

  test('la zona canonica con un modificador local se acepta', () => {
    const raiz = crearProyecto({
      'src/modal/Pagos.css': '.pagosFacturaAcciones { justify-content: space-between; }',
    });
    const violaciones = verificarModalAccionesNoCanonico(
      [modal, '<div className="modalAcciones pagosFacturaAcciones">'],
      [raiz],
    );

    assert.strictEqual(violaciones.length, 0);
  });
});

suite('css-elemento-html-directo — superficie de contenido', () => {
  /* [15A-25] El marcado de una superficie de contenido (markdown, rich text,
   * contentEditable) lo genera un renderizador: sus h2/h3 no llevan className y el
   * remedio que la regla prescribe no es aplicable. Se reconoce por su forma — una
   * misma clase estiliza tres o mas elementos crudos distintos. */
  test('no dispara en una clase que estiliza el marcado inyectado', () => {
    const texto = [
      '.editorArticuloContenido { line-height: 1.6; }',
      '.editorArticuloContenido h2 { font-size: 20px; }',
      '.editorArticuloContenido h3 { font-size: 17px; }',
      '.editorArticuloContenido p { margin-bottom: 12px; }',
      '.editorArticuloContenido ul { padding-left: 20px; }',
    ].join('\n');
    const violaciones = verificarCssElementoHTMLDirecto(
      texto,
      crearDocumento('/repo/frontend/src/components/articulos/modalArticulo.css'),
      'modalArticulo.css',
    );

    assert.strictEqual(violaciones.length, 0);
  });

  test('si dispara cuando la clase solo estiliza un h* del componente', () => {
    const texto = [
      '.panelResumen { display: flex; }',
      '.panelResumen h2 { font-size: 18px; }',
    ].join('\n');
    const violaciones = verificarCssElementoHTMLDirecto(
      texto,
      crearDocumento('/repo/frontend/src/components/panel/Panel.css'),
      'Panel.css',
    );

    assert.strictEqual(violaciones.length, 1);
    assert.match(violaciones[0]?.mensaje || '', /h2/);
  });

  test('sigue detectando el selector de button raw', () => {
    const texto = '.tarjetaItem button { background: none; }';
    const violaciones = verificarCssElementoHTMLDirecto(
      texto,
      crearDocumento('/repo/frontend/src/components/panel/Panel.css'),
      'Panel.css',
    );

    assert.strictEqual(violaciones.length, 1);
  });
});

suite('modal-estructura-no-canonica — contenedor que fusiona la className', () => {
  /* El fixture reproduce la linea real de KAMPLES
   * (frontend/src/legacy/components/ui/modal/Modal.tsx:80): el array lleva una
   * indexacion dentro, que es justo lo que la version anterior de la regex no
   * cruzaba y por lo que el veredicto quedaba muerto en el proyecto real. */
  const MODAL_QUE_FUSIONA = [
    'export function Modal({ className = \'\' }: Props) {',
    '  const clasesContenedor = [\'modalContenedor\', mapaTamano[tamano], className]',
    '  return <div className="modalOverlay"><div className={clasesContenedor.join(\' \')} /></div>;',
    '}',
  ].join('\n');

  const CON_CLASSNAME = ['<Modal abierto={abierto} onCerrar={onCerrar} className="usuariosModal">'];

  test('el detector reconoce el array con indexacion anidada', () => {
    const raiz = crearProyecto({ 'src/modal/Modal.tsx': MODAL_QUE_FUSIONA });

    assert.strictEqual(indiceProyecto([raiz]).modalFusionaClassName, true);
  });

  test('el detector reconoce la plantilla y la concatenacion', () => {
    const plantilla = crearProyecto({
      'src/modal/Modal.tsx': 'return <div className={`modalContenedor ${className}`} />;',
    });
    const concatenacion = crearProyecto({
      'src/modal/Modal.tsx': 'return <div className={"modalContenedor " + className} />;',
    });

    assert.strictEqual(indiceProyecto([plantilla]).modalFusionaClassName, true);
    assert.strictEqual(indiceProyecto([concatenacion]).modalFusionaClassName, true);
  });

  test('no dispara cuando el <Modal> del proyecto appendea la className', () => {
    const raiz = crearProyecto({ 'src/modal/Modal.tsx': MODAL_QUE_FUSIONA });

    const violaciones = verificarModalEstructuraNoCanonica(
      CON_CLASSNAME,
      'SeccionUsuarios.tsx',
      true,
      indiceProyecto([raiz]).modalFusionaClassName,
    );

    assert.strictEqual(violaciones.length, 0);
  });

  test('dispara cuando el proyecto no demuestra la fusion (fail-closed)', () => {
    const raiz = crearProyecto({
      'src/modal/Modal.tsx': 'return <div className="modalContenedor" />;',
    });

    const violaciones = verificarModalEstructuraNoCanonica(
      CON_CLASSNAME,
      'SeccionUsuarios.tsx',
      true,
      indiceProyecto([raiz]).modalFusionaClassName,
    );

    assert.strictEqual(violaciones.length, 1);
  });
});
