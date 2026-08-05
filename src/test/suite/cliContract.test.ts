import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeCliTarget, parseCliArgs } from '../../cli';
import { validateSentinelConfig } from '../../core/config';

suite('Sentinel CLI contract', () => {
  test('acepta una lista de archivos relativa al workspace', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-files-'));
    const sourcePath = path.join(workspace, 'sample.ts');
    const listPath = path.join(workspace, 'files.txt');
    fs.writeFileSync(sourcePath, 'export const value = 1;\n', 'utf8');
    fs.writeFileSync(listPath, 'sample.ts\n# comentario\nsample.ts\n', 'utf8');

    try {
      const result = await analyzeCliTarget(parseCliArgs([
        'analyze', '--workspace', workspace, '--files-from', listPath, '--format', 'json',
      ]));
      assert.strictEqual(result.totalArchivos, 1);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('rechaza archivos fuera del workspace', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-scope-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-outside-'));
    const outsideFile = path.join(outside, 'outside.ts');
    const listPath = path.join(workspace, 'files.txt');
    fs.writeFileSync(outsideFile, 'export const value = 1;\n', 'utf8');
    fs.writeFileSync(listPath, `${outsideFile}\n`, 'utf8');

    try {
      await assert.rejects(
        analyzeCliTarget(parseCliArgs(['analyze', '--workspace', workspace, '--files-from', listPath])),
        /fuera del workspace/,
      );
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('rechaza claves y reglas desconocidas en config', () => {
    assert.throws(() => validateSentinelConfig({ unknown: true }), /clave desconocida/);
    assert.throws(() => validateSentinelConfig({ rules: { 'regla-inexistente': {} } }), /regla desconocida/);
  });

  test('parsea install/update/rollback con sus opciones', () => {
    const install = parseCliArgs(['install', '--source-root', 'src', '--target-root', 'rt', '--version', '1.0.0', '--dry-run', '--json']);
    assert.strictEqual(install.command, 'install');
    assert.strictEqual(install.sourceRoot, 'src');
    assert.strictEqual(install.targetRoot, 'rt');
    assert.strictEqual(install.runtimeVersion, '1.0.0');
    assert.strictEqual(install.dryRun, true);
    assert.strictEqual(install.json, true);

    const update = parseCliArgs(['update', '--target-root', 'rt']);
    assert.strictEqual(update.command, 'update');
    assert.strictEqual(update.targetRoot, 'rt');

    const rollback = parseCliArgs(['rollback', '--version', '0.9.0']);
    assert.strictEqual(rollback.command, 'rollback');
    assert.strictEqual(rollback.runtimeVersion, '0.9.0');
  });

  test('rechaza opciones desconocidas en install', () => {
    assert.throws(() => parseCliArgs(['install', '--no-such-flag']), /Opcion no reconocida/);
  });
});
