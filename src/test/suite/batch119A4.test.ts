/* [119A-4] Regression batch: falsos positivos verificados contra oraculo 0.7.10.
 * Cada test cita el sitio del oraculo que lo motivo. */
import * as assert from 'assert';
import { reglasEstaticas } from '../../config/defaultRules';
import { createCoreDocument } from '../../core/types';
import { esRutaGlory, proyectoTieneModalCanonico } from '../../utils/analisisHelpers';
import { verificarReglasPortables } from '../../analyzers/static/portableRules';
import { verificarCssHardcoded, verificarModalSemanticaNoCanonica } from '../../analyzers/static/staticCssRules';
import {
  verificarKeyIndexLista,
  verificarMenuContextualOverride,
  verificarModalEstructuraNoCanonica,
} from '../../analyzers/react/reactComponentRules';

function docCss(fileName: string, content: string) {
  return createCoreDocument({ uri: `file://${fileName}`, fileName, languageId: 'css', content });
}

function patronTodo(): RegExp {
  const regla = reglasEstaticas.find(r => r.id === 'todo-pendiente');
  assert.ok(regla, 'existe regla todo-pendiente');
  return new RegExp(regla.patron.source, regla.patron.flags.replace('g', ''));
}

suite('119A-4 S1 todo-pendiente: prosa espanola no es marcador', () => {
  test('ignora "todo en el VPS" (coolify db_tmp.rs:199)', () => {
    assert.strictEqual(patronTodo().test('/// todo en el VPS (montaje temporal)'), false);
  });

  test('ignora "todo el historial" (harness context.rs:971)', () => {
    assert.strictEqual(patronTodo().test('/// todo el historial de mensajes'), false);
  });

  test('ignora "Pendiente de validacion" (REST bdp_sync.rs:674)', () => {
    assert.strictEqual(patronTodo().test('/* Pendiente de validación por el comercio */'), false);
  });

  test('sigue detectando TODO/FIXME/HACK/XXX explicitos', () => {
    assert.ok(patronTodo().test('// TODO: migrar a roadmap'));
    assert.ok(patronTodo().test('# FIXME roto'));
    assert.ok(patronTodo().test('/* HACK temporal */'));
    assert.ok(patronTodo().test('// XXX revisar'));
  });
});

suite('119A-4 S2 css-hardcoded: mask-image es luminancia', () => {
  test('ignora #000 en mask-image (AGAPE Donar.css:118-119)', () => {
    const texto = [
      '.mascara {',
      '  mask-image: linear-gradient(#000, transparent);',
      '  -webkit-mask-image: linear-gradient(#000, transparent);',
      '}',
    ].join('\n');
    const v = verificarCssHardcoded(texto, docCss('/repo/x.css', texto), 'x.css');
    assert.strictEqual(v.length, 0);
  });

  test('sigue detectando hex real fuera de mask-image', () => {
    const texto = '.panel { background: #f0f0f0; }';
    const v = verificarCssHardcoded(texto, docCss('/repo/x.css', texto), 'x.css');
    assert.strictEqual(v.length, 1);
  });
});

suite('119A-4 S3 menu-contextual: propio componente y tag de apertura', () => {
  test('ignora el propio MenuContextual.tsx (PT :67,73)', () => {
    const lineas = ['<div className="separador" />'];
    assert.strictEqual(verificarMenuContextualOverride(lineas, 'MenuContextual.tsx').length, 0);
  });

  test('ignora clase en linea hermana (PT EncabezadoPerfil.tsx:110)', () => {
    const lineas = [
      '<MenuContextual',
      '  trigger={<Boton icono="opciones" />}',
      '>',
      '  <div className="perfilMenu">',
    ];
    assert.strictEqual(verificarMenuContextualOverride(lineas, 'EncabezadoPerfil.tsx').length, 0);
  });

  test('sigue detectando override real en el tag de apertura', () => {
    const lineas = ['<MenuContextual className="menuLocal" trigger={<Boton />}>'];
    const v = verificarMenuContextualOverride(lineas, 'Consumidor.tsx');
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0]?.reglaId, 'menu-contextual-override-diseno');
  });
});

suite('119A-4 S4 modal: sin canonica no hay deuda', () => {
  test('estructura: panelFormulario sin sistema no dispara (AGAPE ModalEditarMetodo.tsx:207)', () => {
    const v = verificarModalEstructuraNoCanonica(
      ['<form className="panelFormulario" onSubmit={h}>'],
      'ModalEditarMetodo.tsx',
      false,
    );
    assert.strictEqual(v.length, 0);
  });

  test('semantica: panelModalAcciones sin sistema no dispara (AGAPE PanelAdmin.css:663)', () => {
    const texto = '.panelModalAcciones { display: flex; gap: 8px; }';
    const v = verificarModalSemanticaNoCanonica(
      texto, docCss('/repo/PanelAdmin.css', texto), 'PanelAdmin.css', false,
    );
    assert.strictEqual(v.length, 0);
  });

  test('con canonica presente la regla sigue disparando (fail-open anterior)', () => {
    const v = verificarModalEstructuraNoCanonica(
      ['<form className="panelFormulario" onSubmit={h}>'],
      'ModalEditarMetodo.tsx',
      true,
    );
    assert.strictEqual(v.length, 1);
  });

  test('proyectoTieneModalCanonico es fail-closed sin roots', () => {
    assert.strictEqual(proyectoTieneModalCanonico([]), true);
  });
});

suite('119A-4 S5 key-index: slots fijos Array().fill()', () => {
  test('ignora key={index} sobre slots fijos (AGAPE VistaHistoria.tsx:223)', () => {
    const lineas = [
      'const [imagenes, setImagenes] = useState<string[]>(Array(NUMERO_IMAGENES).fill(""));\n'.trim(),
      'return imagenes.map((img, index) => (',
      '  <div key={index}>{img}</div>',
      '));',
    ];
    assert.strictEqual(verificarKeyIndexLista(lineas).length, 0);
  });

  test('sigue detectando key={index} en lista dinamica', () => {
    const lineas = [
      'return items.map((item, index) => (',
      '  <div key={index}>{item.nombre}</div>',
      '));',
    ];
    const v = verificarKeyIndexLista(lineas);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0]?.reglaId, 'key-index-lista');
  });
});

suite('119A-4 S6 portable: strings no son referencias', () => {
  function tsDoc(content: string) {
    return createCoreDocument({ uri: 'file:///w/etiquetas.ts', fileName: '/w/etiquetas.ts', languageId: 'typescript', content });
  }

  test('ignora window.location dentro de string (WM etiquetas.ts:78)', () => {
    const v = verificarReglasPortables(tsDoc('export const doc = "usa window.location para X";'));
    assert.strictEqual(v.some(f => f.reglaId === 'window-reference-outside-platform'), false);
  });

  test('sigue detectando window.location real', () => {
    const v = verificarReglasPortables(tsDoc('const url = window.location.href;'));
    assert.ok(v.some(f => f.reglaId === 'window-reference-outside-platform'));
  });
});

suite('119A-4 S7 esRutaGlory cubre glory-core', () => {
  test('glory-core es ruta de framework', () => {
    assert.strictEqual(esRutaGlory('C:/repo/frontend/src/glory-core/components/Boton.tsx'), true);
  });

  test('/Glory/ sigue siendo ruta de framework', () => {
    assert.strictEqual(esRutaGlory('C:/repo/Glory/Modal.tsx'), true);
  });

  test('codigo de producto no es ruta de framework', () => {
    assert.strictEqual(esRutaGlory('C:/repo/frontend/src/features/panel.tsx'), false);
  });
});
