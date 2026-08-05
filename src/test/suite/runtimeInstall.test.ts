/* [028A-6 Fase 1] Tests del contrato de actualización/rollback del runtime
 * global (politica-actualizacion-rollback-sentinel-2026-08-04.md): staging
 * temporal, hash verificable, alias current atómico, versión anterior
 * conservada, dry-run sin mutaciones y rollback restaurable. Todos los
 * tests usan targetRoot aislado en temp; nunca tocan el runtime real. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  hashArtifact,
  installRuntime,
  listVersions,
  rollbackRuntime,
  runtimeStatus,
} from '../../core/runtimeInstall';

suite('Sentinel core runtimeInstall (contrato de actualización)', () => {
  function makeSource(version: string): string {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-runtime-src-'));
    fs.mkdirSync(path.join(source, 'out', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), `${JSON.stringify({ name: 'glory-sentinel', version }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(source, 'out', 'cli', 'index.js'), 'console.log("sentinel");\n', 'utf8');
    return source;
  }

  test('instala versión con current atómico y hash verificable', async () => {
    const source = makeSource('1.2.3');
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-runtime-target-'));
    try {
      const result = await installRuntime({ sourceRoot: source, targetRoot: target });
      assert.strictEqual(result.version, '1.2.3');
      assert.strictEqual(result.changedCurrent, true);
      assert.strictEqual(result.previousVersion, null);
      assert.ok(result.artifactSha256.length === 64, 'hash sha256 del artefacto');

      const current = JSON.parse(fs.readFileSync(path.join(target, 'current.json'), 'utf8')) as { version?: string; artifactSha256?: string };
      assert.strictEqual(current.version, '1.2.3');
      assert.strictEqual(current.artifactSha256, result.artifactSha256);

      const manifest = JSON.parse(fs.readFileSync(path.join(target, 'versions', '1.2.3', 'manifest.json'), 'utf8')) as { artifactSha256?: string };
      assert.strictEqual(manifest.artifactSha256, result.artifactSha256);
      assert.ok(fs.existsSync(path.join(target, 'versions', '1.2.3', 'out', 'cli', 'index.js')));
      assert.ok(fs.existsSync(path.join(target, 'current.js')), 'shim CLI resuelto por current.json');
      assert.ok(fs.existsSync(path.join(target, 'bin', 'sentinel.cmd')) || fs.existsSync(path.join(target, 'bin', 'sentinel')));

      const status = await runtimeStatus({ targetRoot: target });
      assert.strictEqual(status.activeVersion, '1.2.3');
      assert.strictEqual(status.activeVerified, true, 'hash verificado contra el artefacto instalado');
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('update con la misma versión refresca sin romper el current', async () => {
    const source = makeSource('1.5.0');
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-runtime-samever-'));
    try {
      await installRuntime({ sourceRoot: source, targetRoot: target });
      /* [028A-6] Regresión: re-instalar la misma versión crasheaba con
       * EEXIST en Windows (rename sobre directorio existente). */
      const refresh = await installRuntime({ sourceRoot: source, targetRoot: target });
      assert.strictEqual(refresh.changedCurrent, false);
      assert.strictEqual((await runtimeStatus({ targetRoot: target })).activeVersion, '1.5.0');
      assert.ok(fs.existsSync(path.join(target, 'versions', '1.5.0')), 'la versión sigue instalada');
      assert.ok(!fs.existsSync(path.join(target, '.retired')), 'no quedan residuos retired');
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('update a nueva versión conserva la anterior para rollback', async () => {
    const sourceV1 = makeSource('1.0.0');
    const sourceV2 = makeSource('1.1.0');
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-runtime-update-'));
    try {
      await installRuntime({ sourceRoot: sourceV1, targetRoot: target });
      const first = await runtimeStatus({ targetRoot: target });
      const update = await installRuntime({ sourceRoot: sourceV2, targetRoot: target });
      assert.strictEqual(update.previousVersion, '1.0.0');
      assert.strictEqual(update.version, '1.1.0');
      assert.strictEqual(update.changedCurrent, true);

      const versions = await listVersions(target);
      assert.deepStrictEqual(versions.map(info => info.version).sort(), ['1.0.0', '1.1.0']);
      assert.strictEqual((await runtimeStatus({ targetRoot: target })).activeVersion, '1.1.0');
      assert.ok(first.activeVersion === '1.0.0', 'la primera instalación activó 1.0.0');
    } finally {
      fs.rmSync(sourceV1, { recursive: true, force: true });
      fs.rmSync(sourceV2, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('rollback restaura la versión anterior conservada', async () => {
    const sourceV1 = makeSource('2.0.0');
    const sourceV2 = makeSource('2.1.0');
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-runtime-rollback-'));
    try {
      await installRuntime({ sourceRoot: sourceV1, targetRoot: target });
      await installRuntime({ sourceRoot: sourceV2, targetRoot: target });
      const rollback = await rollbackRuntime({ targetRoot: target });
      assert.strictEqual(rollback.previousVersion, '2.1.0');
      assert.strictEqual(rollback.restoredVersion, '2.0.0');
      assert.strictEqual((await runtimeStatus({ targetRoot: target })).activeVersion, '2.0.0');

      /* Rollback explícito a la versión exacta. */
      const explicit = await rollbackRuntime({ targetRoot: target, version: '2.1.0' });
      assert.strictEqual(explicit.restoredVersion, '2.1.0');
      assert.strictEqual((await runtimeStatus({ targetRoot: target })).activeVersion, '2.1.0');
    } finally {
      fs.rmSync(sourceV1, { recursive: true, force: true });
      fs.rmSync(sourceV2, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('rollback rechaza una versión sin artifactSha256 (manifest ausente)', async () => {
    const sourceV1 = makeSource('4.0.0');
    const sourceV2 = makeSource('4.1.0');
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-runtime-nohash-'));
    try {
      await installRuntime({ sourceRoot: sourceV1, targetRoot: target });
      await installRuntime({ sourceRoot: sourceV2, targetRoot: target });
      /* Corrupto el manifest de la anterior: pierde el hash declarado. */
      fs.writeFileSync(
        path.join(target, 'versions', '4.0.0', 'manifest.json'),
        `${JSON.stringify({ version: '4.0.0' })}\n`,
        'utf8',
      );
      const result = await rollbackRuntime({ targetRoot: target });
      assert.strictEqual(result.restoredVersion, null);
      assert.match(result.reason, /no declara artifactSha256/);
      /* El current sigue apuntando a la versión activa. */
      assert.strictEqual((await runtimeStatus({ targetRoot: target })).activeVersion, '4.1.0');
    } finally {
      fs.rmSync(sourceV1, { recursive: true, force: true });
      fs.rmSync(sourceV2, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('rollback rechaza una versión cuyo contenido no coincide con su hash', async () => {
    const sourceV1 = makeSource('5.0.0');
    const sourceV2 = makeSource('5.1.0');
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-runtime-tampered-'));
    try {
      await installRuntime({ sourceRoot: sourceV1, targetRoot: target });
      await installRuntime({ sourceRoot: sourceV2, targetRoot: target });
      /* Manipulo el artefacto instalado de la anterior: ya no coincide con
       * el artifactSha256 del manifest. El rollback debe negarse. */
      fs.appendFileSync(
        path.join(target, 'versions', '5.0.0', 'out', 'cli', 'index.js'),
        '// tampered\n',
        'utf8',
      );
      const result = await rollbackRuntime({ targetRoot: target });
      assert.strictEqual(result.restoredVersion, null);
      assert.match(result.reason, /no supera la verificación/);
      assert.strictEqual((await runtimeStatus({ targetRoot: target })).activeVersion, '5.1.0');
    } finally {
      fs.rmSync(sourceV1, { recursive: true, force: true });
      fs.rmSync(sourceV2, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('rollback sin versión anterior informa motivo y no muta', async () => {
    const source = makeSource('3.0.0');
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-runtime-noprev-'));
    try {
      await installRuntime({ sourceRoot: source, targetRoot: target });
      const before = await runtimeStatus({ targetRoot: target });
      const result = await rollbackRuntime({ targetRoot: target });
      assert.strictEqual(result.restoredVersion, null);
      assert.match(result.reason, /no hay versión anterior/);
      assert.strictEqual((await runtimeStatus({ targetRoot: target })).activeVersion, before.activeVersion);
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('dry-run no escribe nada en el runtime', async () => {
    const source = makeSource('4.0.0');
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-runtime-dry-'));
    try {
      const result = await installRuntime({ sourceRoot: source, targetRoot: target, dryRun: true });
      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.changedCurrent, false);
      assert.strictEqual(result.artifactSha256, '');
      assert.strictEqual(fs.readdirSync(target).length, 0, 'el target queda vacío en dry-run');
      assert.ok(!fs.existsSync(path.join(target, 'current.json')));
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('hashArtifact es determinista y sensible al contenido', async () => {
    const source = makeSource('5.0.0');
    try {
      const first = await hashArtifact(source);
      const second = await hashArtifact(source);
      assert.strictEqual(first, second);
      fs.writeFileSync(path.join(source, 'out', 'cli', 'index.js'), 'console.log("changed");\n', 'utf8');
      const mutated = await hashArtifact(source);
      assert.notStrictEqual(mutated, first, 'el hash cambia con el contenido');
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
    }
  });
});
