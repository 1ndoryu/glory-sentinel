/* [028A-6 Fase 1] Tests del contrato de actualización/rollback del runtime
 * global (politica-actualizacion-rollback-sentinel-2026-08-04.md): staging
 * temporal, hash verificable, alias current atómico, versión anterior
 * conservada, dry-run sin mutaciones y rollback restaurable. Todos los
 * tests usan targetRoot aislado en temp; nunca tocan el runtime real. */
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  hashArtifact,
  installRuntime,
  listVersions,
  rollbackRuntime,
  runtimeStatus,
  uninstallRuntime,
} from '../../core/runtimeInstall';
import { PROFILE_MARKER_START, PROFILE_MARKER_END } from '../../core/interceptorShims';

suite('Sentinel core runtimeInstall (contrato de actualización)', () => {
  function makeSource(version: string): string {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-runtime-src-'));
    fs.mkdirSync(path.join(source, 'out', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), `${JSON.stringify({ name: 'glory-sentinel', version }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(source, 'out', 'cli', 'index.js'), `if (process.argv.includes('--version')) console.log('${version}');\n`, 'utf8');
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
      const activeCliVersion = execFileSync(process.execPath, [path.join(target, 'current.js'), '--version'], { encoding: 'utf8' }).trim();
      assert.strictEqual(activeCliVersion, '1.2.3', 'el shim debe resolver la versión declarada por current.json');

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

/* [028A-6 Fase 5] Tests de la desinstalación: retira SOLO entradas
 * administradas (PATH shims+bin, marcadores de perfiles nuevos/legacy,
 * shims y opcionalmente bin/current/versions). PATH y perfiles se inyectan
 * para no tocar el entorno real. */
suite('Sentinel core runtimeInstall (desinstalación)', () => {
  /* Construye un árbol de runtime administrado completo + un PATH con las
   * entradas shims/bin + un perfil con el bloque del guard. */
  function makeManaged(target: string): { pathValue: string; profile: string } {
    fs.mkdirSync(path.join(target, 'shims'), { recursive: true });
    fs.mkdirSync(path.join(target, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(target, 'versions', '1.0.0'), { recursive: true });
    fs.mkdirSync(path.join(target, '.tmp', 'staging'), { recursive: true });
    fs.mkdirSync(path.join(target, '.retired', '0.9.0'), { recursive: true });
    fs.writeFileSync(path.join(target, 'shims', 'npm.cmd'), '@echo off\r\n', 'utf8');
    fs.writeFileSync(path.join(target, 'bin', 'sentinel.cmd'), '@echo off\r\n', 'utf8');
    fs.writeFileSync(path.join(target, 'current.js'), '#!/usr/bin/env node\n', 'utf8');
    fs.writeFileSync(path.join(target, 'current.json'), `${JSON.stringify({ version: '1.0.0' })}\n`, 'utf8');
    fs.writeFileSync(path.join(target, 'versions', '1.0.0', 'manifest.json'), `${JSON.stringify({ version: '1.0.0', artifactSha256: 'x'.repeat(64) })}\n`, 'utf8');
    const profile = path.join(target, 'fake-profile.ps1');
    fs.writeFileSync(profile, `# mi perfil\n${PROFILE_MARKER_START}\n# guard\n${PROFILE_MARKER_END}\n# resto\n`, 'utf8');
    const shimsEntry = path.join(target, 'shims');
    const binEntry = path.join(target, 'bin');
    return { pathValue: `${shimsEntry};${binEntry};C:\\herramientas`, profile };
  }

  test('dry-run reporta la retirada sin mutar nada', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-uninstall-dry-'));
    try {
      const { pathValue, profile } = makeManaged(target);
      const writes: string[] = [];
      const result = await uninstallRuntime({
        targetRoot: target,
        dryRun: true,
        pathRead: async () => pathValue,
        pathWrite: async (value: string) => { writes.push(value); },
        profiles: { powershell: [profile], bash: [] },
      });
      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.pathEntry.action, 'removed');
      assert.strictEqual(result.removedShimsDir, true);
      assert.strictEqual(result.removedVersions, true);
      assert.strictEqual(result.removedBinDir, true);
      assert.strictEqual(writes.length, 0, 'no escribe PATH en dry-run');
      assert.ok(fs.existsSync(path.join(target, 'current.json')), 'no borra el runtime en dry-run');
      assert.ok(fs.existsSync(path.join(target, 'shims', 'npm.cmd')));
      assert.ok(fs.existsSync(profile), 'no toca el perfil en dry-run');
      assert.ok(fs.existsSync(path.join(target, 'versions', '1.0.0', 'manifest.json')));
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('desinstala solo lo administrado y conserva la raíz', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-uninstall-real-'));
    try {
      const { pathValue, profile } = makeManaged(target);
      fs.writeFileSync(path.join(target, 'mis-datos.txt'), 'no administrado\n', 'utf8');
      let wrotePath: string | null = null;
      const result = await uninstallRuntime({
        targetRoot: target,
        pathRead: async () => pathValue,
        pathWrite: async (value: string) => { wrotePath = value; },
        profiles: { powershell: [profile], bash: [] },
      });
      assert.strictEqual(result.activeVersion, '1.0.0');
      assert.strictEqual(result.pathEntry.action, 'removed');
      const writtenPath = wrotePath ?? '';
      assert.notStrictEqual(writtenPath, '', 'se esperaba la escritura del PATH');
      assert.ok(!writtenPath.includes('shims') && !writtenPath.includes('bin'), 'PATH sin entradas del runtime');
      assert.ok(writtenPath.includes('C:\\herramientas'), 'conserva el resto del PATH');
      assert.ok(result.profiles.some(item => item.action === 'removed'), 'marcador del perfil retirado');
      const profileContent = fs.readFileSync(profile, 'utf8');
      assert.ok(!profileContent.includes(PROFILE_MARKER_START), 'bloque del guard eliminado');
      assert.ok(profileContent.includes('# mi perfil') && profileContent.includes('# resto'), 'contenido ajeno conservado');
      assert.ok(!fs.existsSync(path.join(target, 'shims')));
      assert.ok(!fs.existsSync(path.join(target, 'bin')));
      assert.ok(!fs.existsSync(path.join(target, 'current.json')));
      assert.ok(!fs.existsSync(path.join(target, 'current.js')));
      assert.ok(!fs.existsSync(path.join(target, 'versions')));
      assert.ok(!fs.existsSync(path.join(target, '.tmp')));
      assert.ok(!fs.existsSync(path.join(target, '.retired')));
      assert.ok(fs.existsSync(path.join(target, 'mis-datos.txt')), 'no borra entradas ajenas');
      assert.ok(fs.existsSync(target), 'la raíz del runtime se conserva');
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('--keep-runtime conserva versions/current/bin y solo retira la integración', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-uninstall-keep-'));
    try {
      const { pathValue, profile } = makeManaged(target);
      const result = await uninstallRuntime({
        targetRoot: target,
        keepRuntime: true,
        pathRead: async () => pathValue,
        pathWrite: async () => {},
        profiles: { powershell: [profile], bash: [] },
      });
      assert.strictEqual(result.keepRuntime, true);
      assert.strictEqual(result.pathEntry.action, 'removed');
      assert.ok(result.profiles.some(item => item.action === 'removed'));
      assert.ok(!fs.existsSync(path.join(target, 'shims')), 'shims interceptores retirados');
      assert.ok(fs.existsSync(path.join(target, 'versions', '1.0.0', 'manifest.json')), 'runtime conservado');
      assert.ok(fs.existsSync(path.join(target, 'current.json')), 'alias actual conservado');
      assert.ok(fs.existsSync(path.join(target, 'current.js')), 'resolver CLI conservado');
      assert.ok(fs.existsSync(path.join(target, 'bin', 'sentinel.cmd')), 'comando sentinel conservado');
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('propaga el error del PATH como acción error sin mutar el resto', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-uninstall-err-'));
    try {
      const { pathValue, profile } = makeManaged(target);
      const result = await uninstallRuntime({
        targetRoot: target,
        pathRead: async () => pathValue,
        pathWrite: async () => { throw new Error('permiso denegado'); },
        profiles: { powershell: [profile], bash: [] },
      });
      assert.strictEqual(result.pathEntry.action, 'error');
      assert.match(result.pathEntry.error ?? '', /permiso denegado/);
      assert.ok(result.profiles.some(item => item.action === 'removed'), 'perfiles aún se retiran');
      assert.ok(!fs.existsSync(path.join(target, 'shims')), 'los shims se retiran igualmente');
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('sin integración instalada reporta unchanged y no muta', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-uninstall-none-'));
    try {
      const profile = path.join(target, 'perfil-sin-marcadores.ps1');
      fs.writeFileSync(profile, '# contenido normal\n', 'utf8');
      const result = await uninstallRuntime({
        targetRoot: target,
        pathRead: async () => 'C:\\herramientas',
        pathWrite: async () => { throw new Error('no debería escribir'); },
        profiles: { powershell: [profile], bash: [] },
      });
      assert.strictEqual(result.pathEntry.action, 'unchanged');
      assert.ok(result.profiles.every(item => item.action === 'unchanged'));
      assert.strictEqual(result.removedShimsDir, false);
      assert.strictEqual(result.removedVersions, false);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test('sin marcador de runtime no retira directorios ajenos del filesystem', async () => {
    /* [028A-6 Fase 5] Regresión del revisor: un --target-root erróneo (C:\,
     * un directorio de proyecto) con shims/bin/versions que existan por
     * casualidad NO debe borrarlos: solo se retiran directorios cuando el
     * target tiene marcador de runtime (current.json/current.js/versions). */
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-uninstall-marker-'));
    try {
      fs.mkdirSync(path.join(target, 'shims'), { recursive: true });
      fs.mkdirSync(path.join(target, 'bin'), { recursive: true });
      fs.mkdirSync(path.join(target, 'versions'), { recursive: true });
      fs.mkdirSync(path.join(target, '.tmp'), { recursive: true });
      fs.writeFileSync(path.join(target, 'shims', 'npm.cmd'), '@echo off\r\n', 'utf8');
      const result = await uninstallRuntime({
        targetRoot: target,
        pathRead: async () => 'C:\\herramientas',
        pathWrite: async () => { throw new Error('no debería escribir'); },
        profiles: { powershell: [], bash: [] },
      });
      assert.strictEqual(result.removedShimsDir, false, 'no retira shims sin marcador de runtime');
      assert.strictEqual(result.removedBinDir, false);
      assert.strictEqual(result.removedVersions, false);
      assert.strictEqual(result.removedTmp, false);
      assert.ok(fs.existsSync(path.join(target, 'shims', 'npm.cmd')), 'nada se borra');
      assert.deepStrictEqual(result.errors, []);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});
