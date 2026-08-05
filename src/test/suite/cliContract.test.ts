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

  test('parsea --with-shims y --with-profiles en install', () => {
    const withFlags = parseCliArgs(['install', '--target-root', 'rt', '--with-shims', '--with-profiles']);
    assert.strictEqual(withFlags.withShims, true);
    assert.strictEqual(withFlags.withProfiles, true);
    const plain = parseCliArgs(['install', '--target-root', 'rt']);
    assert.strictEqual(plain.withShims, undefined);
    assert.strictEqual(plain.withProfiles, undefined);
  });

  test('parsea --with-path y --without-path en install', () => {
    const withPath = parseCliArgs(['install', '--target-root', 'rt', '--with-path']);
    assert.strictEqual(withPath.withPath, true);
    const withoutPath = parseCliArgs(['install', '--target-root', 'rt', '--without-path']);
    assert.strictEqual(withoutPath.withoutPath, true);
    const update = parseCliArgs(['update', '--target-root', 'rt', '--with-path']);
    assert.strictEqual(update.withPath, true);
  });

  test('rechaza opciones desconocidas en install', () => {
    assert.throws(() => parseCliArgs(['install', '--no-such-flag']), /Opcion no reconocida/);
  });

  test('parsea el subcomando lease con sus opciones', () => {
    const issue = parseCliArgs(['lease', 'issue', '--project-root', '/p', '--task-id', 'T-1', '--command', 'cargo test', '--ttl-ms', '60000', '--json']);
    assert.strictEqual(issue.command, 'lease');
    assert.strictEqual(issue.leaseAction, 'issue');
    assert.strictEqual(issue.workspacePath, '/p');
    assert.strictEqual(issue.taskId, 'T-1');
    assert.strictEqual(issue.leaseCommand, 'cargo test');
    assert.strictEqual(issue.leaseTtlMs, 60000);
    assert.strictEqual(issue.json, true);

    const revoke = parseCliArgs(['lease', 'revoke', '--lease', '/x/lease.json']);
    assert.strictEqual(revoke.leaseAction, 'revoke');
    assert.strictEqual(revoke.leasePath, '/x/lease.json');

    const verify = parseCliArgs(['lease', 'verify', '--lease', '/x/lease.json', '--pid', '42']);
    assert.strictEqual(verify.leaseAction, 'verify');
    assert.strictEqual(verify.leasePid, 42);

    const list = parseCliArgs(['lease', 'list']);
    assert.strictEqual(list.leaseAction, 'list');

    assert.throws(() => parseCliArgs(['lease', 'bogus']), /Acción lease no reconocida/);
    assert.throws(() => parseCliArgs(['lease', 'verify', '--lease', '/x', '--pid', 'abc']), /--pid debe ser un PID válido/);
    assert.throws(() => parseCliArgs(['lease', 'issue', '--ttl-ms', '-5']), /--ttl-ms debe ser un entero positivo/);
  });
});
