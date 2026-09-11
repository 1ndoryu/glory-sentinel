import * as assert from 'assert';
import { reglasEstaticas } from '../../config/defaultRules';
import { analizarEstatico } from '../../analyzers/staticAnalyzer';

function crearDocumento(texto: string, fileName = 'src/components/panel/HostingStats.tsx') {
  const lineas = texto.split('\n');

  return {
    fileName,
    lineCount: lineas.length,
    languageId: 'typescriptreact',
    getText: () => texto,
    lineAt: (line: number) => ({ text: lineas[line] ?? '' }),
  } as never;
}

function contar(texto: string): number {
  const regla = reglasEstaticas.find(r => r.id === 'inline-style-prohibido');
  assert.ok(regla, 'La regla inline-style-prohibido debe existir');
  return analizarEstatico(crearDocumento(texto), [regla!]).length;
}

suite('inline-style-prohibido con CSS vars', () => {
  test('ignora style inline de una sola linea cuando solo define custom properties', () => {
    const regla = reglasEstaticas.find(r => r.id === 'inline-style-prohibido');
    assert.ok(regla, 'La regla inline-style-prohibido debe existir');

    const texto = '<div className="barra" style={{\'--hosting-bar-width\': `${percent}%`} as CSSProperties} />';
    const violaciones = analizarEstatico(crearDocumento(texto), [regla!]);
    assert.strictEqual(violaciones.length, 0);
  });

  /* [039A-1 FP-S1] El binario 0.7.4 del area solo eximia una unica custom
   * property autocerrada, asi que un objeto de 2 vars se reportaba como estilo
   * inline real. El objeto con varias custom properties es el mismo patron
   * correcto (inyectar valores dinamicos de JS a CSS), no una violacion. */
  test('ignora un objeto con varias custom properties en una sola linea', () => {
    assert.strictEqual(contar("<div style={{'--a': x, '--b': y}} />"), 0);
  });

  test('ignora un objeto multilinea con varias custom properties', () => {
    const texto = [
      '<div',
      '  className="barra"',
      '  style={{',
      "    '--hosting-bar-width': `${percent}%`,",
      "    '--hosting-bar-color': color,",
      '  } as CSSProperties}',
      '/>',
    ].join('\n');
    assert.strictEqual(contar(texto), 0);
  });

  /* Anti-sobreexclusion: si el objeto mezcla una custom property con una
   * propiedad real, sigue siendo estilo inline y debe reportarse. */
  test('reporta el objeto que mezcla una custom property con una propiedad real', () => {
    assert.strictEqual(contar("<div style={{'--a': x, color: 'red'}} />"), 1);
  });

  /* [039A-1 FP-S1 real, medido en EditorPixelArt.tsx] En TypeScript la custom
   * property no puede ir como clave literal porque CSSProperties no admite
   * claves `--*`; se escribe con indice computado (`['--x' as string]: valor`).
   * Es el mismo patron correcto, no un estilo inline real. */
  test('ignora la custom property con clave computada y as string', () => {
    assert.strictEqual(contar("<div style={{['--pixel-df' as string]: dimensiones}} />"), 0);
  });

  test('ignora la custom property con clave computada sin asercion de tipo', () => {
    assert.strictEqual(contar("<div style={{['--pixel-df']: dimensiones}} />"), 0);
  });

  test('ignora la custom property con clave computada en objeto multilinea', () => {
    const texto = [
      '<div',
      '  className="editor"',
      '  style={{',
      "    ['--pixel-df' as string]: dimensiones,",
      "    ['--pixel-cs' as string]: celda,",
      '  }}',
      '/>',
    ].join('\n');
    assert.strictEqual(contar(texto), 0);
  });

  /* Anti-sobreexclusion: una clave computada que NO se puede probar que sea una
   * custom property sigue reportandose, y mezclarla con una propiedad real
   * tambien. Si no, cualquier indice computado quedaria exento por la puerta
   * de atras. */
  test('reporta la clave computada que no es una custom property', () => {
    assert.strictEqual(contar('<div style={{[clave]: valor}} />'), 1);
  });

  test('reporta la clave computada de custom property mezclada con una propiedad real', () => {
    assert.strictEqual(contar("<div style={{['--a' as string]: x, width: '100%'}} />"), 1);
  });

  /* [039A-1 FP-S2] Un `style={{}}` dentro de un comentario no es codigo. La
   * regla es un regex por linea y el comentario JSX usa la misma sintaxis de
   * bloque que el comentario C, asi que sin saltar comentarios se reporta un
   * estilo que no existe. Caso real: SelectorRepeticionPill.tsx. */
  test('no reporta style inline dentro de un comentario JSX de una linea', () => {
    assert.strictEqual(contar("{/* se usa style={{color: 'red'}} por compatibilidad */}"), 0);
  });

  test('no reporta style inline en la continuacion de un comentario JSX multilinea', () => {
    const texto = [
      '{/* [19-08-2026] span en vez de Boton: un <button> dentro de otro',
      " * <button> es HTML invalido; se usa style={{color: 'red'}} como nota. */}",
    ].join('\n');
    assert.strictEqual(contar(texto), 0);
  });

  test('no reporta style inline en un comentario de bloque C-style', () => {
    const texto = [
      '/* TODO: sustituir style={{color: "red"}} por una clase CSS */',
      "<div className=\"real\" />",
    ].join('\n');
    assert.strictEqual(contar(texto), 0);
  });

  /* Anti-sobreexclusion del salto de comentarios: el codigo real que va despues
   * de un comentario cerrado se sigue reportando. */
  test('reporta el style inline real que aparece despues de un comentario cerrado', () => {
    const texto = [
      '{/* nota */}',
      "<div style={{color: 'red'}} />",
    ].join('\n');
    assert.strictEqual(contar(texto), 1);
  });

  /* Anti-sobreexclusion: un `//` dentro de un string (una URL) no abre un
   * comentario de linea, asi que el estilo inline de esa linea se reporta. */
  test('no confunde una URL dentro de un string con un comentario de linea', () => {
    assert.strictEqual(contar('<a href="https://ejemplo.test" style={{color: \'red\'}} />'), 1);
  });
});