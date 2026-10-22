import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeCliTarget, parseCliArgs } from '../../../cli';
import { renderOutput } from '../../../cli/comandos/cliAnalyze';
import { SENTINEL_JSON_SCHEMA_VERSION } from '../../../cli/parseo/argsTypes';
import { tempDir } from '../../temporales';

/* [SQ-4/SQ-5] Invariantes de los límites de analyze. Los contratos existentes (formato, rc, claves)
 * no cambian sin límites activos: estos tests fijan lo que se añade. */

function crearWorkspace(archivos: Record<string, string>): string {
  const workspace = tempDir('sentinel-limites-');
  for (const [rel, contenido] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(workspace, rel)), { recursive: true });
    fs.writeFileSync(path.join(workspace, rel), contenido, 'utf8');
  }
  return workspace;
}

function contarHallazgos(entries: { findings: unknown[] }[]): number {
  return entries.reduce((total, entry) => total + entry.findings.length, 0);
}

suite('Sentinel CLI: límites de analyze (tamaño, deadline, hallazgos)', () => {
  test('por defecto omite archivos de más de 1 MiB sin leerlos y lo cuenta', async () => {
    const workspace = crearWorkspace({
      'pequeno.ts': 'export const a = 1;\n',
      'volcado.ts': 'x'.repeat(1024 * 1024 + 1),
    });
    try {
      const result = await analyzeCliTarget(parseCliArgs(['analyze', '--workspace', workspace, '--format', 'json']));
      assert.strictEqual(result.totalArchivos, 2, 'el archivo omitido sigue contando como encontrado');
      assert.strictEqual(result.limites.archivosOmitidosPorTamano, 1);
      assert.strictEqual(result.limites.maxFileBytes, 1024 * 1024);
      assert.strictEqual(result.entries.some(entry => entry.ruta.endsWith('volcado.ts')), false);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('--max-file-bytes 0 desactiva el tope', async () => {
    const workspace = crearWorkspace({ 'grande.ts': 'x'.repeat(5000) });
    try {
      const result = await analyzeCliTarget(parseCliArgs([
        'analyze', '--workspace', workspace, '--max-file-bytes', '0', '--format', 'json',
      ]));
      assert.strictEqual(result.limites.archivosOmitidosPorTamano, 0);
      assert.strictEqual(result.limites.maxFileBytes, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('--max-findings recorta hallazgos sin cambiar hasErrors ni totalArchivos', async () => {
    const archivos: Record<string, string> = {};
    /* any explícito: una regla estática que dispara por archivo. */
    for (let i = 0; i < 12; i++) { archivos[`mod${i}.ts`] = 'export const v: any = 1;\n'; }
    const workspace = crearWorkspace(archivos);
    try {
      const base = await analyzeCliTarget(parseCliArgs(['analyze', '--workspace', workspace, '--format', 'json']));
      const total = contarHallazgos(base.entries);
      /* [por que] Testigo: sin esto, el recorte podría pasar en vacío. */
      assert.ok(total > 2, `el workspace de prueba debe producir más de 2 hallazgos (hay ${total})`);

      const limitado = await analyzeCliTarget(parseCliArgs([
        'analyze', '--workspace', workspace, '--max-findings', '2', '--format', 'json',
      ]));
      assert.strictEqual(contarHallazgos(limitado.entries), 2);
      assert.strictEqual(limitado.limites.hallazgosOmitidos, total - 2);
      assert.strictEqual(limitado.hasErrors, base.hasErrors);
      assert.strictEqual(limitado.totalArchivos, base.totalArchivos);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('--deadline-ms: deadlineAlcanzado solo si quedan archivos sin analizar', async () => {
    const archivos: Record<string, string> = {};
    for (let i = 0; i < 20; i++) { archivos[`mod${i}.ts`] = 'export const v = 1;\n'; }
    const workspace = crearWorkspace(archivos);
    try {
      const sinLimite = await analyzeCliTarget(parseCliArgs(['analyze', '--workspace', workspace, '--format', 'json']));
      assert.strictEqual(sinLimite.limites.deadlineAlcanzado, false);
      assert.strictEqual(sinLimite.limites.archivosNoAnalizados, 0);

      const ajustado = await analyzeCliTarget(parseCliArgs([
        'analyze', '--workspace', workspace, '--deadline-ms', '1', '--format', 'json',
      ]));
      assert.strictEqual(ajustado.limites.deadlineAlcanzado, ajustado.limites.archivosNoAnalizados > 0);
      assert.strictEqual(ajustado.totalArchivos, 20);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('JSON conserva schemaVersion y añade limites; markdown avisa de lo omitido', async () => {
    const workspace = crearWorkspace({ 'volcado.ts': 'x'.repeat(3000), 'a.ts': 'export const a = 1;\n' });
    try {
      const jsonArgs = parseCliArgs(['analyze', '--workspace', workspace, '--max-file-bytes', '1000', '--format', 'json']);
      const json = JSON.parse(renderOutput(await analyzeCliTarget(jsonArgs), jsonArgs, '0.0.0'));
      assert.strictEqual(json.schemaVersion, SENTINEL_JSON_SCHEMA_VERSION);
      assert.strictEqual(json.limites.archivosOmitidosPorTamano, 1);

      const mdArgs = parseCliArgs(['analyze', '--workspace', workspace, '--max-file-bytes', '1000']);
      const markdown = renderOutput(await analyzeCliTarget(mdArgs), mdArgs, '0.0.0');
      assert.ok(markdown.startsWith('> Aviso: 1 archivo(s) omitidos por superar 1000 bytes'), markdown.slice(0, 120));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('el deadline por defecto esta acotado y --deadline-ms 0 lo desactiva', async () => {
    const workspace = crearWorkspace({ 'a.ts': 'export const a = 1;\n' });
    try {
      const porDefecto = await analyzeCliTarget(parseCliArgs(['analyze', '--workspace', workspace, '--format', 'json']));
      assert.strictEqual(porDefecto.limites.deadlineMs, 600000);
      assert.strictEqual(porDefecto.limites.deadlineAlcanzado, false);

      const sinLimite = await analyzeCliTarget(parseCliArgs([
        'analyze', '--workspace', workspace, '--deadline-ms', '0', '--format', 'json',
      ]));
      assert.strictEqual(sinLimite.limites.deadlineMs, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('rechaza valores no enteros y límites fuera de analyze', () => {
    assert.throws(() => parseCliArgs(['analyze', '--max-file-bytes', '-1']), /entero mayor o igual que 0/);
    assert.throws(() => parseCliArgs(['analyze', '--deadline-ms', '1.5']), /--deadline-ms debe ser/);
    assert.throws(() => parseCliArgs(['check', '--max-findings', '2']), /solo aplican a analyze/);
  });
});
