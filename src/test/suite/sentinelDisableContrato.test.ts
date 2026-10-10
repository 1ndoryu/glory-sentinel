/*
 * Contrato disable de Sentinel ([259A-5]).
 * Toda regla React honra `sentinel-disable-file <id>` (token exacto, mismo
 * archivo) y `sentinel-disable-next-line <id>` (ventana de 5 lineas hacia
 * atras, aunque haya codigo entre el disable y la linea reportada — patron
 * JSX: disable sobre el contenedor, violacion en una linea interna).
 * Casos origen: NAKOMI SeccionPagos (next-line sobre wrappers), AppLauncher
 * (file-level menu), ModalSeoEdit (file-level artesanal), DeploymentRow
 * (supresion cruzada por substring componente-sin-hook).
 */

import * as assert from 'assert';
import {
  verificarModalConTitulo,
  verificarModalAccionesNoCanonico,
} from '../../analyzers/react/reactModalRules';
import {
  verificarMenuContextualOverride,
  verificarComponenteArtesanal,
  verificarKeyIndexLista,
  verificarHtmlNativoEnVezDeComponente,
  verificarComponenteSinHook,
  verificarMutacionDirectaEstado,
} from '../../analyzers/react/reactComponentRules';
import {
  tieneSentinelDisable,
  tieneSentinelDisableFile,
} from '../../utils/analisisHelpers';

suite('disable-file — token exacto', () => {
  test('id con sufijo no exime al id base', () => {
    const texto = '/* sentinel-disable-file componente-sin-hook-glory: fila SRP */';
    assert.strictEqual(tieneSentinelDisableFile(texto, 'componente-sin-hook'), false);
    assert.strictEqual(tieneSentinelDisableFile(texto, 'componente-sin-hook-glory'), true);
  });

  test('id base no exime al id con sufijo', () => {
    const texto = '/* sentinel-disable-file componente-sin-hook: wiring trivial */';
    assert.strictEqual(tieneSentinelDisableFile(texto, 'componente-sin-hook-glory'), false);
    assert.strictEqual(tieneSentinelDisableFile(texto, 'componente-sin-hook'), true);
  });

  test('one-liner multi-regla exime a cada id', () => {
    const texto = '/* [259A-5] sentinel-disable-file html-nativo-en-vez-de-componente componente-artesanal: migracion fase 5b. */';
    assert.strictEqual(tieneSentinelDisableFile(texto, 'html-nativo-en-vez-de-componente'), true);
    assert.strictEqual(tieneSentinelDisableFile(texto, 'componente-artesanal'), true);
    assert.strictEqual(tieneSentinelDisableFile(texto, 'menu-contextual-override-diseno'), false);
  });

  test('separadores : y -- tras el id siguen matcheando', () => {
    assert.strictEqual(
      tieneSentinelDisableFile('/* sentinel-disable-file key-index-lista: strings sin IDs */', 'key-index-lista'),
      true,
    );
    assert.strictEqual(
      tieneSentinelDisableFile('// sentinel-disable-next-line modal-con-titulo -- factura', 'modal-con-titulo'),
      false,
      'next-line no es file-level',
    );
  });

  test('bare sentinel-disable-file no exime ninguna regla', () => {
    assert.strictEqual(tieneSentinelDisableFile('/* sentinel-disable-file */', 'html-nativo-en-vez-de-componente'), false);
  });
});

suite('disable-next-line — ventana de 5 lineas con codigo intermedio', () => {
  test('suprime aunque haya lineas de codigo entre disable y violacion (SeccionPagos)', () => {
    const lineas = [
      '<div className="pagosFacturaServicio">',
      '{/* sentinel-disable-next-line modal-con-titulo -- factura: h3 titulo de servicio */}',
      '<div className="pagosFacturaServicioInfo">',
      '<h3 className="modalTitulo">Servicio</h3>',
    ];
    assert.strictEqual(tieneSentinelDisable(lineas, 3, 'modal-con-titulo'), true);
  });

  test('no suprime a 6+ lineas de distancia', () => {
    const lineas = [
      '{/* sentinel-disable-next-line modal-con-titulo */}',
      '<div>',
      '<div>',
      '<div>',
      '<div>',
      '<div>',
      '<h3>Titulo</h3>',
    ];
    assert.strictEqual(tieneSentinelDisable(lineas, 6, 'modal-con-titulo'), false);
  });

  test('no suprime otra regla', () => {
    const lineas = [
      '{/* sentinel-disable-next-line modal-con-titulo */}',
      '<h3>Titulo</h3>',
    ];
    assert.strictEqual(tieneSentinelDisable(lineas, 1, 'modal-acciones-no-canonico'), false);
  });
});

suite('modal-con-titulo — next-line sobre contenedor (SeccionPagos:117)', () => {
  const base = [
    '<Modal abierto={abierto} onCerrar={onCerrar}>',
    '<div className="pagosFacturaServicio">',
    '{/* sentinel-disable-next-line modal-con-titulo -- [259A-5] factura */}',
    '<div className="pagosFacturaServicioInfo">',
    '<h3 className="modalTitulo">Servicio</h3>',
  ];

  test('dispara sin disable', () => {
    const sin = base.filter(l => !l.includes('sentinel-disable'));
    assert.strictEqual(verificarModalConTitulo(sin).length, 1);
  });

  test('next-line sobre el wrapper suprime el h3 interno', () => {
    assert.strictEqual(verificarModalConTitulo(base).length, 0);
  });
});

suite('modal-acciones-no-canonico — next-line sobre guarda (SeccionPagos:218)', () => {
  const base = [
    '<Modal abierto={abierto} onCerrar={onCerrar}>',
    '{/* sentinel-disable-next-line modal-acciones-no-canonico -- ya lleva modalAcciones */}',
    '{puedeSolicitarReembolso && (',
    '<div className="modalAcciones pagosFacturaAcciones">',
  ];

  test('dispara sin disable', () => {
    const sin = base.filter(l => !l.includes('sentinel-disable'));
    assert.strictEqual(verificarModalAccionesNoCanonico(sin).length, 1);
  });

  test('next-line suprime aunque la clase este 2 lineas despues', () => {
    assert.strictEqual(verificarModalAccionesNoCanonico(base).length, 0);
  });
});

suite('menu-contextual-override-diseno — file-level (AppLauncher)', () => {
  const codigo = ['<MenuContextual abierto={a} onCerrar={c} className="varianteLocal">'];

  test('dispara sin disable', () => {
    assert.strictEqual(verificarMenuContextualOverride(codigo, 'AppLauncher.tsx').length, 1);
  });

  test('file-level suprime', () => {
    const lineas = [
      '/* [259A-5] sentinel-disable-file menu-contextual-override-diseno: variantes por instancia. */',
      ...codigo,
    ];
    assert.strictEqual(verificarMenuContextualOverride(lineas, 'AppLauncher.tsx').length, 0);
  });
});

suite('componente-artesanal — file-level (ModalSeoEdit)', () => {
  const codigo = ['<div className="seoOverlay" onClick={cerrar}>'];

  test('dispara sin disable', () => {
    assert.strictEqual(verificarComponenteArtesanal(codigo, 'ModalSeoEdit.tsx').length, 1);
  });

  test('file-level suprime', () => {
    const lineas = [
      '/* [259A-5] sentinel-disable-file html-nativo-en-vez-de-componente componente-artesanal: migracion fase 5b. */',
      ...codigo,
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas, 'ModalSeoEdit.tsx').length, 0);
  });

  test('next-line inmediatamente superior sigue suprimiendo', () => {
    const lineas = [
      '{/* sentinel-disable-next-line componente-artesanal */}',
      ...codigo,
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas, 'ModalSeoEdit.tsx').length, 0);
  });
});

suite('key-index-lista — file-level y next-line (TabPlanes)', () => {
  const codigo = ['items.map((it, idx) => <Fila key={idx} nombre={it} />)'];

  test('dispara sin disable', () => {
    assert.strictEqual(verificarKeyIndexLista(codigo).length, 1);
  });

  test('file-level suprime', () => {
    const lineas = ['/* sentinel-disable-file key-index-lista: strings sin IDs */', ...codigo];
    assert.strictEqual(verificarKeyIndexLista(lineas).length, 0);
  });

  test('next-line suprime', () => {
    const lineas = ['{/* sentinel-disable-next-line key-index-lista: strings sin IDs */}', ...codigo];
    assert.strictEqual(verificarKeyIndexLista(lineas).length, 0);
  });
});

suite('html-nativo — file-level con token exacto (GaleriaHero)', () => {
  const codigo = ['<select value={v} onChange={onChange}>'];

  test('dispara sin disable', () => {
    assert.strictEqual(verificarHtmlNativoEnVezDeComponente(codigo, 'GaleriaHero.tsx').length, 1);
  });

  test('file-level suprime', () => {
    const lineas = [
      '/* [259A-5] sentinel-disable-file html-nativo-en-vez-de-componente: fase 5b. */',
      ...codigo,
    ];
    assert.strictEqual(verificarHtmlNativoEnVezDeComponente(lineas, 'GaleriaHero.tsx').length, 0);
  });
});

suite('componente-sin-hook-glory — ambas grafias eximen, sin cruce', () => {
  const cuerpo = [
    'import { useState, useEffect } from "react";',
    'export function Fila(): JSX.Element {',
    'const [a, setA] = useState(0);',
    'useEffect(() => { fetch("/x").then(r => setA(1)); }, []);',
    'if (a > 0) { fetch("/y"); }',
    'try { await fetch("/z"); } catch (e) { await fetch("/w"); }',
    'for (let i = 0; i < a; i++) { await fetch("/v"); }',
    'while (a > 1) { break; }',
    'switch (a) { case 1: break; }',
    'return <div>{a}</div>;',
    '}',
  ];

  test('dispara sin disable', () => {
    const v = verificarComponenteSinHook(cuerpo, 'Fila.tsx');
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0]?.reglaId, 'componente-sin-hook-glory');
  });

  test('file-level con id actual suprime (DeploymentRow)', () => {
    const lineas = ['/* [259A-5] sentinel-disable-file componente-sin-hook-glory: fila SRP. */', ...cuerpo];
    assert.strictEqual(verificarComponenteSinHook(lineas, 'Fila.tsx').length, 0);
  });

  test('file-level con grafia historica suprime (SubTab*)', () => {
    const lineas = ['/* sentinel-disable-file componente-sin-hook: wiring trivial. */', ...cuerpo];
    assert.strictEqual(verificarComponenteSinHook(lineas, 'Fila.tsx').length, 0);
  });

  test('ignora la logica de helpers de modulo antes del componente', () => {
    const helper = Array.from({ length: 11 }, (_, i) => `if (x > ${i}) { n++; }`);
    const lineas = [
      'import { useState } from "react";',
      'function textoUsos(x: number): number {',
      'let n = 0;',
      ...helper,
      'return n;',
      '}',
      'export function Fila(): JSX.Element {',
      'return <div />;',
      '}',
    ];
    assert.strictEqual(verificarComponenteSinHook(lineas, 'Fila.tsx').length, 0);
  });

  test('archivo kebab-case: useChatsMarketplace cuenta como hook dedicado', () => {
    assert.strictEqual(verificarComponenteSinHook(cuerpo, 'chats-marketplace.tsx').length, 1);
    const conHook = [cuerpo[0], 'import { useChatsMarketplace } from "./use-chats-marketplace";', ...cuerpo.slice(1)];
    assert.strictEqual(verificarComponenteSinHook(conHook, 'chats-marketplace.tsx').length, 0);
  });
});

suite('mutacion-directa-estado — file-level y next-line', () => {
  const codigo = [
    'const [items, setItems] = useState([]);',
    'items.push(nuevo);',
  ];

  test('dispara sin disable', () => {
    assert.strictEqual(verificarMutacionDirectaEstado(codigo).length, 1);
  });

  test('next-line suprime', () => {
    const lineas = [codigo[0], '// sentinel-disable-next-line mutacion-directa-estado', codigo[1]];
    assert.strictEqual(verificarMutacionDirectaEstado(lineas).length, 0);
  });

  test('file-level suprime', () => {
    const lineas = ['// sentinel-disable-file mutacion-directa-estado', ...codigo];
    assert.strictEqual(verificarMutacionDirectaEstado(lineas).length, 0);
  });
});
