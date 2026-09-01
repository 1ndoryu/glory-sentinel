import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { verificarHtmlNativoEnVezDeComponente, configurarWorkspaceRootsReact } from '../../analyzers/react/reactComponentRules';

suite('select-nativo-prohibido', () => {
  test('detecta select nativo aunque no exista componente Select con nombre literal', () => {
    const violaciones = verificarHtmlNativoEnVezDeComponente([
      '<label>VPS<select value={target} onChange={cambiarTarget}>',
      '  <option value="default">default</option>',
      '</select></label>',
    ], 'Formulario.tsx');

    assert.strictEqual(violaciones.length, 1);
    assert.strictEqual(violaciones[0].reglaId, 'html-nativo-en-vez-de-componente');
    assert.match(violaciones[0]?.mensaje || '', /selector personalizado/);
  });

  test('no confunde componentes Selector personalizados con select nativo', () => {
    const violaciones = verificarHtmlNativoEnVezDeComponente([
      '<SelectorPersonalizado etiqueta="VPS" valor={target} opciones={opciones} onCambiar={setTarget} />',
    ], 'Formulario.tsx');

    assert.strictEqual(violaciones.length, 0);
  });
});

/* [318A-3] F2: las bases relativas ahora cubren el layout de PROYECTO TASKS
 * (frontend/src/app/components/ui + shared) y 'Range' no se auto-flaggea. */
suite('base-rutas-components-ui-318a3', () => {
  const crearFixture = (): string => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-base-rui-'));
    const ui = path.join(raiz, 'frontend', 'src', 'app', 'components', 'ui');
    const shared = path.join(raiz, 'frontend', 'src', 'app', 'components', 'shared');
    fs.mkdirSync(ui, {recursive: true});
    fs.mkdirSync(shared, {recursive: true});
    for (const nombre of ['Boton', 'Input', 'Textarea', 'Select', 'Checkbox']) {
      fs.writeFileSync(path.join(ui, `${nombre}.tsx`), `export function ${nombre}(){return null;}`);
    }
    fs.writeFileSync(path.join(shared, 'Range.tsx'), 'export function Range(){return null;}');
    return raiz;
  };

  test('detecta componentes UI en frontend/src/app/components/ui', () => {
    const raiz = crearFixture();
    try {
      configurarWorkspaceRootsReact([raiz]);
      const violaciones = verificarHtmlNativoEnVezDeComponente([
        '<button onClick={guardar}>Guardar</button>',
        '<input value={draft} onChange={cambiar} />',
        '<textarea value={texto} onChange={cambiar} />',
      ], 'Pagina.tsx');
      assert.strictEqual(violaciones.length, 3);
    } finally {
      fs.rmSync(raiz, {recursive: true, force: true});
    }
  });

  test('Range (components/shared) no se auto-flaggea', () => {
    const raiz = crearFixture();
    try {
      configurarWorkspaceRootsReact([raiz]);
      const violaciones = verificarHtmlNativoEnVezDeComponente([
        '<input type="range" min={0} max={100} value={v} onChange={cambiar} />',
      ], 'Range.tsx');
      assert.strictEqual(violaciones.length, 0);
    } finally {
      fs.rmSync(raiz, {recursive: true, force: true});
    }
  });

  test('<Select> no se marca deprecated cuando no existe SelectDropdown', () => {
    const raiz = crearFixture();
    try {
      configurarWorkspaceRootsReact([raiz]);
      const violaciones = verificarHtmlNativoEnVezDeComponente([
        '<Select claseAdicional="x" opciones={opciones} value={v} onChange={c>} />',
      ], 'Formulario.tsx');
      assert.strictEqual(violaciones.length, 0);
    } finally {
      fs.rmSync(raiz, {recursive: true, force: true});
    }
  });
});