import * as assert from 'assert';

interface Violacion {
  reglaId: string;
  linea: number;
}

function esClaseBotonEspecifica(nombreClase: string): boolean {
  const clasesSistema = new Set([
    'botonBase', 'botonPrimario', 'botonSecundario', 'botonOutline', 'botonTexto',
    'botonExito', 'botonExitoSuave', 'botonPeligro', 'botonPeligroSuave',
    'botonAdvertencia', 'botonAdvertenciaSuave', 'botonInfo', 'botonInfoSuave',
    'botonPequeno', 'botonMediano', 'botonGrande',
  ]);

  if (!nombreClase || clasesSistema.has(nombreClase)) {
    return false;
  }

  return /(?:boton|button)[A-Z]/i.test(nombreClase)
    || /(?:^|[-_])(?:boton|button)(?:[-_][\w-]+)+$/i.test(nombreClase);
}

function verificarButtonClaseEspecifica(lineas: string[], nombreArchivo: string): Violacion[] {
  const nombreBase = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  if (['Boton', 'BotonBase', 'Button'].includes(nombreBase)) { return []; }
  if (nombreArchivo.includes('.test.') || nombreArchivo.includes('.spec.') || nombreArchivo.includes('_generated')) { return []; }
  if (lineas.join('\n').includes('sentinel-disable-file button-clase-especifica')) { return []; }

  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (!/<(?:Button|Boton|button)\b/.test(linea)) { continue; }
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line button-clase-especifica')) { continue; }

    const fragmento = lineas.slice(i, Math.min(i + 6, lineas.length)).join(' ');
    const classMatch = /className\s*=\s*(?:\{\s*`([^`]+)`\s*\}|`([^`]+)`|["']([^"']+)["'])/.exec(fragmento);
    if (!classMatch) { continue; }

    const rawClassName = classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? '';
    const claseProblematica = rawClassName.split(/\s+/).find(esClaseBotonEspecifica);
    if (!claseProblematica) { continue; }

    violaciones.push({ reglaId: 'button-clase-especifica', linea: i });
  }

  return violaciones;
}

suite('button-clase-especifica', () => {
  test('detecta className especifico sobre Button', () => {
    const lineas = [
      '<Button',
      '  className="reembolsoBotonRevisar"',
      '  type="button"',
      '/>',
    ];
    const violaciones = verificarButtonClaseEspecifica(lineas, 'SeccionReembolsos.tsx');
    assert.strictEqual(violaciones.length, 1);
  });

  test('detecta className especifico sobre button nativo', () => {
    const lineas = ['<button className="cta-boton-principal">Comprar</button>'];
    const violaciones = verificarButtonClaseEspecifica(lineas, 'Checkout.tsx');
    assert.strictEqual(violaciones.length, 1);
  });

  test('ignora Button con clases del sistema', () => {
    const lineas = ['<Button className="botonTexto">Abrir</Button>'];
    const violaciones = verificarButtonClaseEspecifica(lineas, 'Header.tsx');
    assert.strictEqual(violaciones.length, 0);
  });

  test('ignora clases sin patron de boton', () => {
    const lineas = ['<Button className="perfilReviewTab">Recibidas</Button>'];
    const violaciones = verificarButtonClaseEspecifica(lineas, 'UsuarioPublicoIsland.tsx');
    assert.strictEqual(violaciones.length, 0);
  });

  test('respeta sentinel-disable-next-line', () => {
    const lineas = [
      '/* sentinel-disable-next-line button-clase-especifica */',
      '<Button className="reembolsoBotonRevisar">Revisar</Button>',
    ];
    const violaciones = verificarButtonClaseEspecifica(lineas, 'SeccionReembolsos.tsx');
    assert.strictEqual(violaciones.length, 0);
  });
});