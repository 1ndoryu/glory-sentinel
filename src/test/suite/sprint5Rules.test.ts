/*
 * Tests para las reglas del Sprint 5.
 * Cubre las 5 reglas nuevas implementadas en reactAnalyzer.ts y staticAnalyzer.ts:
 * - componente-artesanal (2 patrones: outside-click + overlay)
 * - fallo-sin-feedback
 * - update-optimista-sin-rollback
 * - fetch-sin-timeout
 * - non-null-assertion-excesivo
 *
 * Reimplementa las funciones de deteccion para tests unitarios puros,
 * sin depender del entorno vscode.
 */

import * as assert from 'assert';

/* ========================================================================
 * Reimplementaciones de las funciones del analyzer para tests unitarios.
 * Se copian con la misma logica que en reactAnalyzer.ts y staticAnalyzer.ts
 * para poder ejecutarlos con mocha sin la extension activa.
 * ======================================================================== */

interface Violacion {
  reglaId: string;
  linea: number;
}

/* --- componente-artesanal --- */

function verificarComponenteArtesanal(
  lineas: string[],
  nombreArchivo: string = 'MiComponente.tsx',
): Violacion[] {
  /* Excluir componentes UI base */
  const componentesExcluidos = [
    'Modal', 'Drawer', 'Dialog', 'MenuContextual', 'Dropdown',
    'Popover', 'Tooltip', 'ContenedorToasts', 'Notificacion',
  ];
  const nombreBase = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  if (componentesExcluidos.includes(nombreBase)) {
    return [];
  }

  if (/^use(?:MenuContextual|Modal|Dropdown|Popover|Tooltip)/i.test(nombreBase)) {
    return [];
  }

  if (nombreArchivo.includes('.test.') || nombreArchivo.includes('.spec.') ||
      nombreArchivo.includes('_generated')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    /* sentinel-disable checks */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line componente-artesanal')) {
      continue;
    }
    if (linea.includes('sentinel-disable componente-artesanal')) {
      continue;
    }

    /* Patron 1: outside-click listener artesanal */
    if (/document\.addEventListener\s*\(\s*['"](?:mousedown|click)['"]/i.test(linea)) {
      let dentroUseEffect = false;
      for (let j = Math.max(0, i - 15); j < i; j++) {
        if (/useEffect\s*\(/.test(lineas[j])) {
          dentroUseEffect = true;
          break;
        }
      }

      if (dentroUseEffect) {
        violaciones.push({
          reglaId: 'componente-artesanal',
          linea: i,
        });
      }
    }

    /* Patron 2: overlay/backdrop artesanal */
    if (/<div\b[^>]*(?:className|class)\s*=/.test(linea)) {
      const tieneOverlay = /(?:overlay|backdrop|fondo(?:Modal|Oscuro)|fondoModal)/i.test(linea);
      const tieneOnClick = /onClick\s*=\s*\{/.test(linea);

      if (tieneOverlay && tieneOnClick) {
        violaciones.push({
          reglaId: 'componente-artesanal',
          linea: i,
        });
      }
    }
  }

  return violaciones;
}

/* --- fallo-sin-feedback --- */

function verificarFalloSinFeedback(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  const patronesFeedback = /mostrar(?:Error|Notificacion|Toast)|toast\s*\.\s*(?:error|warning|info|success)|addToast|setError|set[A-Z]\w*Error|agregarNotificacion|notificar|mostrarAlerta/i;

  for (let i = 0; i < lineas.length; i++) {
    if (!/\bcatch\s*\(/.test(lineas[i])) { continue; }

    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line fallo-sin-feedback')) {
      continue;
    }

    let profundidad = 0;
    let inicioBloque = false;
    let tieneConsole = false;
    let tieneFeedback = false;
    let tieneThrow = false;

    for (let j = i; j < Math.min(lineas.length, i + 30); j++) {
      const lineaCatch = lineas[j];

      for (const char of lineaCatch) {
        if (char === '{') { inicioBloque = true; profundidad++; }
        if (char === '}' && inicioBloque) { profundidad--; }
      }

      if (/console\.\s*(?:error|log|warn)\s*\(/.test(lineaCatch)) {
        tieneConsole = true;
      }
      if (patronesFeedback.test(lineaCatch)) {
        tieneFeedback = true;
      }
      if (/\bthrow\b/.test(lineaCatch)) {
        tieneThrow = true;
      }

      if (inicioBloque && profundidad === 0) { break; }
    }

    if (tieneConsole && !tieneFeedback && !tieneThrow) {
      violaciones.push({ reglaId: 'fallo-sin-feedback', linea: i });
    }
  }

  return violaciones;
}

/* --- update-optimista-sin-rollback --- */

function verificarUpdateOptimistaSinRollback(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (!/\bset\s*\(\s*(?:\{|(?:prev|state|s)\s*=>)/.test(linea)) { continue; }

    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line update-optimista-sin-rollback')) {
      continue;
    }

    let lineaAwait = -1;
    for (let j = i + 1; j < Math.min(lineas.length, i + 10); j++) {
      if (/\bawait\b/.test(lineas[j])) {
        lineaAwait = j;
        break;
      }
    }

    if (lineaAwait === -1) { continue; }

    for (let j = lineaAwait; j < Math.min(lineas.length, lineaAwait + 30); j++) {
      if (!/\bcatch\s*\(/.test(lineas[j])) { continue; }

      let tieneRollback = false;
      let profundidad = 0;
      let dentroBloque = false;

      for (let k = j; k < Math.min(lineas.length, j + 20); k++) {
        for (const c of lineas[k]) {
          if (c === '{') { profundidad++; dentroBloque = true; }
          if (c === '}' && dentroBloque) { profundidad--; }
        }
        if (/\bset\s*\(/.test(lineas[k])) {
          tieneRollback = true;
          break;
        }
        if (dentroBloque && profundidad === 0) { break; }
      }

      if (!tieneRollback) {
        violaciones.push({ reglaId: 'update-optimista-sin-rollback', linea: i });
      }
      break;
    }
  }

  return violaciones;
}

/* --- fetch-sin-timeout --- */

function verificarFetchSinTimeout(lineas: string[], nombreArchivo: string = 'componente.tsx'): Violacion[] {
  const nombreBase = nombreArchivo.replace(/\.(ts|tsx|js|jsx)$/, '');
  const archivosCliente = ['apiCliente', 'apiClient', 'httpClient', 'gloryFetch', 'fetchWrapper'];
  if (archivosCliente.includes(nombreBase)) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const texto = lineas.join('\n');
  const tieneAbortController = /AbortController/.test(texto);

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    if (!/\bfetch\s*\(/.test(linea)) { continue; }

    const trimmed = linea.trim();
    if (/^(?:import|type|interface|\/\/|\*|\/\*)/.test(trimmed)) { continue; }

    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line fetch-sin-timeout')) {
      continue;
    }

    let tieneSignal = false;
    for (let j = i; j < Math.min(lineas.length, i + 6); j++) {
      if (/\bsignal\b/.test(lineas[j])) {
        tieneSignal = true;
        break;
      }
    }

    if (!tieneSignal && !tieneAbortController) {
      violaciones.push({ reglaId: 'fetch-sin-timeout', linea: i });
    }
  }

  return violaciones;
}

/* --- non-null-assertion-excesivo --- */

function verificarNonNullAssertionExcesivo(lineas: string[]): Violacion[] {
  const instancias: number[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const trimmed = linea.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    if (linea.includes('sentinel-disable non-null-assertion-excesivo')) { continue; }
    if (i > 0 && lineas[i - 1]?.includes('sentinel-disable-next-line non-null-assertion-excesivo')) { continue; }

    const matches = [...linea.matchAll(/[)\]a-zA-Z0-9_>]!\s*[.\[]/g)];
    for (const match of matches) {
      const posExcl = (match.index ?? 0) + match[0].indexOf('!');
      if (posExcl + 1 < linea.length && linea[posExcl + 1] === '=') { continue; }
      if (posExcl > 0 && linea[posExcl - 1] === '!') { continue; }

      instancias.push(i);
    }
  }

  if (instancias.length < 5) { return []; }

  return instancias.map(lineaNum => ({
    reglaId: 'non-null-assertion-excesivo',
    linea: lineaNum,
  }));
}


/* ========================================================================
 * SUITES DE TEST
 * ======================================================================== */

suite('Sprint 5 - componente-artesanal', () => {

  /* --- Patron 1: outside-click listener artesanal --- */

  test('detecta document.addEventListener mousedown dentro de useEffect', () => {
    const lineas = [
      'export const MiMenu = () => {',
      '  const ref = useRef(null);',
      '  useEffect(() => {',
      '    const handler = (e: MouseEvent) => {',
      '      if (!ref.current?.contains(e.target)) onCerrar();',
      '    };',
      '    document.addEventListener("mousedown", handler);',
      '    return () => document.removeEventListener("mousedown", handler);',
      '  }, []);',
      '  return <div ref={ref}>menu</div>;',
      '};',
    ];
    const v = verificarComponenteArtesanal(lineas);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].reglaId, 'componente-artesanal');
    assert.strictEqual(v[0].linea, 6);
  });

  test('detecta document.addEventListener click dentro de useEffect', () => {
    const lineas = [
      'useEffect(() => {',
      '  document.addEventListener("click", cerrar);',
      '  return () => document.removeEventListener("click", cerrar);',
      '}, []);',
    ];
    const v = verificarComponenteArtesanal(lineas);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].linea, 1);
  });

  test('no detecta addEventListener fuera de useEffect', () => {
    const lineas = [
      'function setup() {',
      '  document.addEventListener("mousedown", handler);',
      '}',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas).length, 0);
  });

  test('no detecta addEventListener para eventos que no son click/mousedown', () => {
    const lineas = [
      'useEffect(() => {',
      '  document.addEventListener("keydown", handler);',
      '}, []);',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas).length, 0);
  });

  /* --- Patron 2: overlay/backdrop artesanal --- */

  test('detecta div overlay con onClick', () => {
    const lineas = [
      '<div className="modalOverlay" onClick={onCerrar}>',
      '  <div className="modalContenido">contenido</div>',
      '</div>',
    ];
    const v = verificarComponenteArtesanal(lineas);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].linea, 0);
  });

  test('detecta div backdrop con onClick', () => {
    const lineas = [
      '<div className="backdrop" onClick={() => setAbierto(false)}>',
    ];
    const v = verificarComponenteArtesanal(lineas);
    assert.strictEqual(v.length, 1);
  });

  test('detecta div fondoModal con onClick', () => {
    const lineas = [
      '<div className="fondoModal" onClick={cerrar}>',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas).length, 1);
  });

  test('detecta div fondoOscuro con onClick', () => {
    const lineas = [
      '<div className="fondoOscuro" onClick={handleClose}>',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas).length, 1);
  });

  test('no detecta overlay sin onClick', () => {
    const lineas = [
      '<div className="overlay">',
      '  contenido',
      '</div>',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas).length, 0);
  });

  test('no detecta div normal con onClick (sin overlay/backdrop)', () => {
    const lineas = [
      '<div className="boton" onClick={manejar}>',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas).length, 0);
  });

  /* --- Exclusiones --- */

  test('excluye archivo Modal.tsx', () => {
    const lineas = [
      '<div className="overlay" onClick={onCerrar}>',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas, 'Modal.tsx').length, 0);
  });

  test('excluye archivo MenuContextual.tsx', () => {
    const lineas = [
      'useEffect(() => {',
      '  document.addEventListener("mousedown", handler);',
      '}, []);',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas, 'MenuContextual.tsx').length, 0);
  });

  test('excluye hook useModal.ts', () => {
    const lineas = [
      'useEffect(() => {',
      '  document.addEventListener("mousedown", fn);',
      '}, []);',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas, 'useModal.ts').length, 0);
  });

  test('excluye archivos .test.tsx', () => {
    const lineas = [
      '<div className="overlay" onClick={fn}>',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas, 'Modal.test.tsx').length, 0);
  });

  /* --- sentinel-disable --- */

  test('respeta sentinel-disable-next-line para patron overlay', () => {
    const lineas = [
      '{/* sentinel-disable-next-line componente-artesanal — justificacion */}',
      '<div className="overlay" onClick={onCerrar}>',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas).length, 0);
  });

  test('respeta sentinel-disable inline', () => {
    const lineas = [
      '<div className="overlay" onClick={fn}> {/* sentinel-disable componente-artesanal */}',
    ];
    assert.strictEqual(verificarComponenteArtesanal(lineas).length, 0);
  });
});


suite('Sprint 5 - fallo-sin-feedback', () => {

  test('detecta catch con solo console.error', () => {
    const lineas = [
      'try {',
      '  await api.guardar(datos);',
      '} catch (e) {',
      '  console.error("Error:", e);',
      '}',
    ];
    const v = verificarFalloSinFeedback(lineas);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].reglaId, 'fallo-sin-feedback');
    assert.strictEqual(v[0].linea, 2);
  });

  test('detecta catch con console.log', () => {
    const lineas = [
      'try { op(); } catch (err) {',
      '  console.log(err);',
      '}',
    ];
    assert.strictEqual(verificarFalloSinFeedback(lineas).length, 1);
  });

  test('detecta catch con console.warn', () => {
    const lineas = [
      'try { op(); }',
      'catch (e) {',
      '  console.warn("algo fallo", e);',
      '}',
    ];
    assert.strictEqual(verificarFalloSinFeedback(lineas).length, 1);
  });

  test('no detecta catch con toast.error', () => {
    const lineas = [
      'try { await guardar(); }',
      'catch (e) {',
      '  console.error(e);',
      '  toast.error("No se pudo guardar");',
      '}',
    ];
    assert.strictEqual(verificarFalloSinFeedback(lineas).length, 0);
  });

  test('no detecta catch con mostrarError', () => {
    const lineas = [
      'catch (e) {',
      '  console.error(e);',
      '  mostrarError("Fallo la operacion");',
      '}',
    ];
    assert.strictEqual(verificarFalloSinFeedback(lineas).length, 0);
  });

  test('no detecta catch con setError', () => {
    const lineas = [
      'catch (err) {',
      '  console.error(err);',
      '  setError(err.message);',
      '}',
    ];
    assert.strictEqual(verificarFalloSinFeedback(lineas).length, 0);
  });

  test('no detecta catch con throw', () => {
    const lineas = [
      'catch (e) {',
      '  console.error(e);',
      '  throw e;',
      '}',
    ];
    assert.strictEqual(verificarFalloSinFeedback(lineas).length, 0);
  });

  test('no detecta catch sin console', () => {
    const lineas = [
      'catch (e) {',
      '  toast.error("Error inesperado");',
      '}',
    ];
    assert.strictEqual(verificarFalloSinFeedback(lineas).length, 0);
  });

  test('no detecta catch vacio (sin console)', () => {
    const lineas = [
      'catch (e) {',
      '}',
    ];
    /* catch-vacio es otra regla; fallo-sin-feedback solo aplica si tiene console */
    assert.strictEqual(verificarFalloSinFeedback(lineas).length, 0);
  });

  test('respeta sentinel-disable-next-line', () => {
    const lineas = [
      'try { op(); }',
      '// sentinel-disable-next-line fallo-sin-feedback',
      'catch (e) {',
      '  console.error(e);',
      '}',
    ];
    assert.strictEqual(verificarFalloSinFeedback(lineas).length, 0);
  });

  test('no detecta catch con agregarNotificacion', () => {
    const lineas = [
      'catch (e) {',
      '  console.error(e);',
      '  agregarNotificacion({ tipo: "error", mensaje: e.message });',
      '}',
    ];
    assert.strictEqual(verificarFalloSinFeedback(lineas).length, 0);
  });
});


suite('Sprint 5 - update-optimista-sin-rollback', () => {

  test('detecta set() optimista sin rollback en catch', () => {
    const lineas = [
      'const toggleLike = async () => {',
      '  set({ liked: true });',
      '  const resp = await api.like(id);',
      '  if (!resp.ok) {',
      '    // no hay rollback',
      '  }',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '};',
    ];
    const v = verificarUpdateOptimistaSinRollback(lineas);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].reglaId, 'update-optimista-sin-rollback');
    assert.strictEqual(v[0].linea, 1);
  });

  test('detecta set(prev => ...) sin rollback', () => {
    const lineas = [
      'set(prev => ({ ...prev, favorito: true }));',
      'await api.favorito(id);',
      '} catch (e) {',
      '  console.error(e);',
      '}',
    ];
    const v = verificarUpdateOptimistaSinRollback(lineas);
    assert.strictEqual(v.length, 1);
  });

  test('no detecta si catch tiene set() (rollback)', () => {
    const lineas = [
      'const previo = get().liked;',
      'set({ liked: !previo });',
      'try {',
      '  await api.toggleLike(id);',
      '} catch (e) {',
      '  set({ liked: previo });',
      '  console.error(e);',
      '}',
    ];
    assert.strictEqual(verificarUpdateOptimistaSinRollback(lineas).length, 0);
  });

  test('no detecta set() sin await posterior (no es optimista)', () => {
    const lineas = [
      'set({ count: count + 1 });',
      'return;',
    ];
    assert.strictEqual(verificarUpdateOptimistaSinRollback(lineas).length, 0);
  });

  test('no detecta set() sin catch posterior', () => {
    const lineas = [
      'set({ valor: true });',
      'await operacion();',
      'set({ valor: false });',
    ];
    assert.strictEqual(verificarUpdateOptimistaSinRollback(lineas).length, 0);
  });

  test('respeta sentinel-disable-next-line', () => {
    const lineas = [
      '// sentinel-disable-next-line update-optimista-sin-rollback',
      'set({ liked: true });',
      'await api.like(id);',
      '} catch (e) {',
      '  console.error(e);',
      '}',
    ];
    assert.strictEqual(verificarUpdateOptimistaSinRollback(lineas).length, 0);
  });

  test('detecta set(state => ...) como variante de state updater', () => {
    const lineas = [
      'set(state => ({ ...state, siguiendo: true }));',
      'await api.seguir(userId);',
      '} catch (e) {',
      '  toast.error("Fallo");',
      '}',
    ];
    /* No tiene set() en catch = sin rollback */
    const v = verificarUpdateOptimistaSinRollback(lineas);
    assert.strictEqual(v.length, 1);
  });
});


suite('Sprint 5 - fetch-sin-timeout', () => {

  test('detecta fetch() sin signal', () => {
    const lineas = [
      'const resp = await fetch("/api/datos");',
    ];
    const v = verificarFetchSinTimeout(lineas);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].reglaId, 'fetch-sin-timeout');
  });

  test('detecta fetch() con opciones pero sin signal', () => {
    const lineas = [
      'const resp = await fetch("/api/datos", {',
      '  method: "POST",',
      '  body: JSON.stringify(datos),',
      '});',
    ];
    const v = verificarFetchSinTimeout(lineas);
    assert.strictEqual(v.length, 1);
  });

  test('no detecta fetch() con signal en misma linea', () => {
    const lineas = [
      'const resp = await fetch("/api/datos", { signal: ctrl.signal });',
    ];
    assert.strictEqual(verificarFetchSinTimeout(lineas).length, 0);
  });

  test('no detecta fetch() con signal en lineas siguientes', () => {
    const lineas = [
      'const resp = await fetch("/api/datos", {',
      '  method: "POST",',
      '  signal: controller.signal,',
      '});',
    ];
    assert.strictEqual(verificarFetchSinTimeout(lineas).length, 0);
  });

  test('no detecta si archivo tiene AbortController global', () => {
    const lineas = [
      'const controller = new AbortController();',
      'setTimeout(() => controller.abort(), 30000);',
      'const resp = await fetch("/api/datos");',
    ];
    assert.strictEqual(verificarFetchSinTimeout(lineas).length, 0);
  });

  test('excluye archivo apiCliente.ts', () => {
    const lineas = [
      'const resp = await fetch(url);',
    ];
    assert.strictEqual(verificarFetchSinTimeout(lineas, 'apiCliente.ts').length, 0);
  });

  test('excluye archivo httpClient.ts', () => {
    const lineas = [
      'const resp = await fetch(url);',
    ];
    assert.strictEqual(verificarFetchSinTimeout(lineas, 'httpClient.ts').length, 0);
  });

  test('excluye archivo gloryFetch.ts', () => {
    const lineas = [
      'const resp = await fetch(url);',
    ];
    assert.strictEqual(verificarFetchSinTimeout(lineas, 'gloryFetch.ts').length, 0);
  });

  test('no detecta fetch en import', () => {
    const lineas = [
      'import { fetch } from "node-fetch";',
    ];
    assert.strictEqual(verificarFetchSinTimeout(lineas).length, 0);
  });

  test('no detecta fetch en comentario', () => {
    const lineas = [
      '// fetch() se usa aqui para obtener datos',
    ];
    assert.strictEqual(verificarFetchSinTimeout(lineas).length, 0);
  });

  test('respeta sentinel-disable-next-line', () => {
    const lineas = [
      '// sentinel-disable-next-line fetch-sin-timeout',
      'const resp = await fetch("/api/datos");',
    ];
    assert.strictEqual(verificarFetchSinTimeout(lineas).length, 0);
  });
});


suite('Sprint 5 - non-null-assertion-excesivo', () => {

  test('detecta 5+ non-null assertions', () => {
    const lineas = [
      'const a = obj!.campo;',
      'const b = arr[0]!.valor;',
      'const c = getData()!.field;',
      'const d = ref.current!.value;',
      'const e = map.get(k)!.name;',
    ];
    const v = verificarNonNullAssertionExcesivo(lineas);
    assert.ok(v.length >= 5, `Esperaba 5+ violaciones, obtuvo ${v.length}`);
    assert.strictEqual(v[0].reglaId, 'non-null-assertion-excesivo');
  });

  test('no detecta 4 o menos assertions', () => {
    const lineas = [
      'const a = obj!.campo;',
      'const b = ref.current!.value;',
      'const c = arr[0]!.prop;',
      'const d = getData()!.name;',
    ];
    assert.strictEqual(verificarNonNullAssertionExcesivo(lineas).length, 0);
  });

  test('no cuenta !== como assertion', () => {
    const lineas = [
      'if (a !== null) {}',
      'if (b !== undefined) {}',
      'if (c !== 0) {}',
      'if (d !== "") {}',
      'if (e !== false) {}',
      'if (f !== null) {}',
    ];
    assert.strictEqual(verificarNonNullAssertionExcesivo(lineas).length, 0);
  });

  test('no cuenta !! (double negation)', () => {
    const lineas = [
      'const a = !!valor;',
      'const b = !!obj;',
      'const c = !!arr;',
      'const d = !!str;',
      'const e = !!num;',
      'const f = !!bool;',
    ];
    assert.strictEqual(verificarNonNullAssertionExcesivo(lineas).length, 0);
  });

  test('ignora lineas de comentario', () => {
    const lineas = [
      '// obj!.campo;',
      '* ref.current!.value;',
      '/* getData()!.field */',
      '// map.get(k)!.name;',
      '// otro!.mas;',
      'const real = unico!.campo;',
    ];
    /* Solo 1 asercion real (la ultima), no llega al umbral de 5 */
    assert.strictEqual(verificarNonNullAssertionExcesivo(lineas).length, 0);
  });

  test('respeta sentinel-disable inline', () => {
    const lineas = [
      'const a = obj!.campo; // sentinel-disable non-null-assertion-excesivo',
      'const b = ref.current!.value;',
      'const c = arr[0]!.prop;',
      'const d = getData()!.name;',
      'const e = map.get(k)!.val;',
    ];
    /* 1 suprimida + 4 reales = no llega a 5 */
    assert.strictEqual(verificarNonNullAssertionExcesivo(lineas).length, 0);
  });

  test('respeta sentinel-disable-next-line', () => {
    const lineas = [
      '// sentinel-disable-next-line non-null-assertion-excesivo',
      'const a = obj!.campo;',
      'const b = ref.current!.value;',
      'const c = arr[0]!.prop;',
      'const d = getData()!.name;',
      'const e = map.get(k)!.val;',
    ];
    /* 1 suprimida + 4 reales = no llega a 5 */
    assert.strictEqual(verificarNonNullAssertionExcesivo(lineas).length, 0);
  });

  test('detecta acceso con brackets: arr[0]![0]', () => {
    const lineas = [
      'const a = arr[0]![0];',
      'const b = obj!.x;',
      'const c = ref!.y;',
      'const d = val!.z;',
      'const e = data!.w;',
    ];
    const v = verificarNonNullAssertionExcesivo(lineas);
    assert.ok(v.length >= 5, `Esperaba 5+ violaciones, obtuvo ${v.length}`);
  });

  test('reporta todas las lineas con assertions (no solo la primera)', () => {
    const lineas = [
      'const a = obj!.campo;',
      'const x = "limpia";',
      'const b = ref!.value;',
      'const c = arr!.prop;',
      'const d = getData()!.name;',
      'const e = map!.val;',
    ];
    const v = verificarNonNullAssertionExcesivo(lineas);
    assert.strictEqual(v.length, 5);
    assert.strictEqual(v[0].linea, 0);
    assert.strictEqual(v[1].linea, 2);
    assert.strictEqual(v[2].linea, 3);
    assert.strictEqual(v[3].linea, 4);
    assert.strictEqual(v[4].linea, 5);
  });
});
