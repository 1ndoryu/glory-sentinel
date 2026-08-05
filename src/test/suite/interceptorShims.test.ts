/* [028A-6 Fase 1] Tests de generación de shims interceptores del runtime y
 * gestión de perfiles con backup: contenido de shims (resolución real sin
 * recursión, preservación de args/exit codes), escritura en <target>/shims,
 * instalación de perfiles con backup previo, idempotencia, dry-run sin
 * mutación y desinstalación que conserva el backup. Todos los tests usan
 * directorios temporales; nunca tocan perfiles reales. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertSafeRuntimePath,
  generateBashGuard,
  generateCmdShim,
  generatePowerShellGuard,
  installProfiles,
  LEGACY_MARKERS,
  PROFILE_MARKER_END,
  PROFILE_MARKER_START,
  uninstallProfiles,
  writeInterceptorShims,
} from '../../core/interceptorShims';

suite('Sentinel core interceptorShims (shims y perfiles)', () => {
  const target = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-shims-'));

  test('shim cmd resuelve el ejecutable real excluyendo su propio path (sin recursión)', () => {
    const npm = generateCmdShim('npm', 'C:\\Glory\\Runtime');
    assert.ok(npm.includes('where node.exe 2^>nul'));
    assert.ok(npm.includes('if not "%%~fI"=="%~dp0node.cmd"'));
    assert.ok(npm.includes('where npm.cmd 2^>nul'));
    assert.ok(npm.includes('if /I not "%%~fI"=="%~f0"'));
    assert.ok(npm.includes('GLORY_REAL_NPM'));
    /* Nunca invoca su propio path: el shim reenvía al real vía GLORY_REAL_* */
    assert.ok(!npm.includes('%~f0\\n%'));
  });

  test('shim cmd invoca el guard del runtime y preserva args y exit codes', () => {
    const cargo = generateCmdShim('cargo', 'C:\\Glory\\Runtime');
    assert.ok(cargo.includes('current.js" guard --project-root "%CD%" --executable cargo -- %*'));
    assert.ok(cargo.includes('if errorlevel 1 exit /b %ERRORLEVEL%'));
    assert.ok(cargo.includes('"%GLORY_REAL_CARGO%" %*'));
    assert.ok(cargo.includes('exit /b %ERRORLEVEL%'));
    assert.ok(cargo.includes('C:\\\\Glory\\\\Runtime'));
    /* CRLF para cmd */
    assert.ok(cargo.includes('\r\n'));
  });

  test('shim cmd de node excluye el node.cmd propio y usa GLORY_REAL_NODE', () => {
    const node = generateCmdShim('node', 'C:\\Glory\\Runtime');
    assert.ok(node.includes('GLORY_REAL_NODE'));
    assert.ok(node.includes('node.exe 2^>nul'));
    assert.ok(node.includes('"%GLORY_REAL_NODE%" %*'));
    /* node no se resuelve a sí mismo: sin where npm.cmd */
    assert.ok(!node.includes('where npm.cmd'));
  });

  test('guard bash define funciones y resuelve el real sin caer a la función node()', () => {
    const bash = generateBashGuard('C:\\Glory\\Runtime');
    for (const name of ['cargo', 'npm', 'npx', 'node', 'vitest', 'tsc', 'eslint', 'prettier']) {
      assert.ok(bash.includes(`${name}() { glory_sentinel_dispatch ${name} "$@"; }`));
    }
    assert.ok(bash.includes('GLORY_REAL_NODE'));
    assert.ok(bash.includes('"$node_bin" "$runtime_host/current.js" guard'));
    /* La resolución del real excluye el directorio del guard (sin recursión). */
    assert.ok(bash.includes('"$candidate" != "$GLORY_SENTINEL_GUARD_DIR/$name"'));
    assert.ok(bash.includes('type -P "${name}.exe"'));
    assert.ok(bash.includes('BASH_ENV'));
    assert.ok(bash.includes('C:/Glory/Runtime') || bash.includes('C:\\\\Glory\\\\Runtime'));
  });

  test('guard PowerShell define funciones y llama al guard del runtime', () => {
    const pwsh = generatePowerShellGuard('C:\\Glory\\Runtime');
    for (const name of ['cargo', 'npm', 'npx', 'node', 'vitest', 'tsc']) {
      assert.ok(pwsh.includes(`function ${name} {`));
    }
    assert.ok(pwsh.includes("'C:\\Glory\\Runtime'"));
    assert.ok(pwsh.includes('current.js') && pwsh.includes('guard --project-root $qualityRoot'));
    assert.ok(pwsh.includes('-CommandType Application'));
  });

  test('writeInterceptorShims escribe los seis artefactos en <target>/shims', async () => {
    const root = target();
    const result = await writeInterceptorShims(root);
    assert.strictEqual(result.files.length, 6);
    for (const name of ['npm.cmd', 'npx.cmd', 'cargo.cmd', 'node.cmd', 'global-quality-guard.sh', 'global-cargo-guard.ps1']) {
      assert.ok(result.files.includes(path.join(result.shimDir, name)), `falta ${name}`);
      assert.ok(fs.existsSync(path.join(result.shimDir, name)));
    }
    assert.ok(fs.readFileSync(path.join(result.shimDir, 'npm.cmd'), 'utf8').includes('GLORY_SENTINEL_RUNTIME'));
  });

  test('installProfiles crea backup del original y es idempotente', async () => {
    const root = target();
    const profile = path.join(root, 'profile.ps1');
    fs.writeFileSync(profile, 'Write-Host "original"\n', 'utf8');
    const backupDir = path.join(root, 'backups');
    const first = await installProfiles({
      shimDir: path.join(root, 'shims'),
      profiles: { powershell: [profile], bash: [] },
      backupDir,
    });
    assert.strictEqual(first.profiles[0].action, 'installed');
    const content = fs.readFileSync(profile, 'utf8');
    assert.ok(content.includes(PROFILE_MARKER_START));
    assert.ok(content.includes(PROFILE_MARKER_END));
    assert.ok(content.includes('Write-Host "original"'));
    /* Backup del original sin marcadores. */
    const backup = fs.readdirSync(backupDir);
    assert.strictEqual(backup.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(backupDir, backup[0]), 'utf8'), 'Write-Host "original"\n');
    /* Idempotente: segunda instalación deja el contenido ya correcto
     * (unchanged) y no duplica el bloque. */
    const second = await installProfiles({
      shimDir: path.join(root, 'shims'),
      profiles: { powershell: [profile], bash: [] },
      backupDir,
    });
    assert.strictEqual(second.profiles[0].action, 'unchanged');
    const content2 = fs.readFileSync(profile, 'utf8');
    assert.strictEqual(
      content2.split(PROFILE_MARKER_START).length - 1,
      1,
      'el bloque no debe duplicarse',
    );
    /* No se crea un segundo backup. */
    assert.strictEqual(fs.readdirSync(backupDir).length, 1);
  });

  test('installProfiles retira marcadores legacy del guard anterior', async () => {
    const root = target();
    const profile = path.join(root, '.bashrc');
    const legacyStart = LEGACY_MARKERS[0][0];
    const legacyEnd = LEGACY_MARKERS[0][1];
    fs.writeFileSync(profile, `alias ll='ls -l'\n${legacyStart}\n. /old/guard.sh\n${legacyEnd}\nexport FOO=1\n`, 'utf8');
    const result = await installProfiles({
      shimDir: path.join(root, 'shims'),
      profiles: { powershell: [], bash: [profile] },
      backupDir: path.join(root, 'backups'),
    });
    assert.strictEqual(result.profiles[0].action, 'updated');
    const content = fs.readFileSync(profile, 'utf8');
    assert.ok(!content.includes(legacyStart), 'el bloque legacy debe retirarse');
    assert.ok(content.includes(PROFILE_MARKER_START));
    assert.ok(content.includes('alias ll'));
    assert.ok(content.includes('export FOO=1'));
  });

  test('installProfiles con dry-run no escribe nada', async () => {
    const root = target();
    const profile = path.join(root, 'profile.ps1');
    fs.writeFileSync(profile, 'original\n', 'utf8');
    const result = await installProfiles({
      shimDir: path.join(root, 'shims'),
      profiles: { powershell: [profile], bash: [] },
      backupDir: path.join(root, 'backups'),
      dryRun: true,
    });
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.profiles[0].action, 'installed');
    assert.strictEqual(fs.readFileSync(profile, 'utf8'), 'original\n');
    assert.ok(!fs.existsSync(path.join(root, 'backups')));
  });

  test('installProfiles crea un perfil inexistente', async () => {
    const root = target();
    const profile = path.join(root, 'nested', 'profile.ps1');
    const result = await installProfiles({
      shimDir: path.join(root, 'shims'),
      profiles: { powershell: [profile], bash: [] },
      backupDir: path.join(root, 'backups'),
    });
    assert.strictEqual(result.profiles[0].action, 'installed');
    assert.ok(fs.existsSync(profile));
    const content = fs.readFileSync(profile, 'utf8');
    assert.ok(content.includes(PROFILE_MARKER_START));
    assert.ok(content.includes('global-cargo-guard.ps1'));
  });

  test('uninstallProfiles retira los bloques y conserva el backup', async () => {
    const root = target();
    const profile = path.join(root, 'profile.ps1');
    fs.writeFileSync(profile, 'original\n', 'utf8');
    const backupDir = path.join(root, 'backups');
    await installProfiles({
      shimDir: path.join(root, 'shims'),
      profiles: { powershell: [profile], bash: [] },
      backupDir,
    });
    const removed = await uninstallProfiles({
      shimDir: path.join(root, 'shims'),
      profiles: { powershell: [profile], bash: [] },
      backupDir,
    });
    assert.strictEqual(removed.profiles[0].action, 'removed');
    /* El contenido vuelve byte a byte al original: se conserva todo lo
     * anterior al marcador y solo se retira el bloque + su salto final. */
    assert.strictEqual(fs.readFileSync(profile, 'utf8'), 'original\n');
    /* El backup original se conserva para restauración manual. */
    assert.strictEqual(fs.readdirSync(backupDir).length, 1);
  });

  test('uninstallProfiles sobre un perfil sin marcadores no muta nada', async () => {
    const root = target();
    const profile = path.join(root, 'profile.ps1');
    fs.writeFileSync(profile, 'sin guard\n', 'utf8');
    const result = await uninstallProfiles({
      shimDir: path.join(root, 'shims'),
      profiles: { powershell: [profile], bash: [] },
    });
    assert.strictEqual(result.profiles[0].action, 'unchanged');
    assert.strictEqual(fs.readFileSync(profile, 'utf8'), 'sin guard\n');
  });

  test('targetRoot con caracteres peligrosos se rechaza antes de generar shims', () => {
    assert.throws(() => assertSafeRuntimePath('C:\\foo&calc\\bar'), /caracteres no permitidos/);
    assert.throws(() => assertSafeRuntimePath('C:\\foo"bar'), /caracteres no permitidos/);
    assert.throws(() => assertSafeRuntimePath('C:\\foo$bar'), /caracteres no permitidos/);
    assert.throws(() => assertSafeRuntimePath('C:\\foo%bar'), /caracteres no permitidos/);
    assert.throws(() => assertSafeRuntimePath('C:\\foo..\\bar'), /\.\./);
    /* Rutas normales con espacios y guiones pasan. */
    assert.strictEqual(assertSafeRuntimePath('C:\\Users\\Owner\\Glory Sentinel-runtime'), 'C:\\Users\\Owner\\Glory Sentinel-runtime');
    assert.throws(() => generateCmdShim('npm', 'C:\\foo&calc\\bar'), /caracteres no permitidos/);
    assert.throws(() => generateBashGuard('C:\\foo$(id)\\bar'), /caracteres no permitidos/);
    assert.throws(() => generatePowerShellGuard('C:\\foo`bar'), /caracteres no permitidos/);
  });

  test('normalizeProfileText solo se aplica a PowerShell (no corrompe bash)', async () => {
    const root = target();
    const bashProfile = path.join(root, '.bashrc');
    /* En bash, backtick seguido de n es texto legítimo dentro de un script
     * y no debe convertirse en un salto de línea real. */
    const userLine = 'alias e=' + String.fromCharCode(96) + 'n' + "='echo n'\n";
    fs.writeFileSync(bashProfile, userLine, 'utf8');
    const result = await installProfiles({
      shimDir: path.join(root, 'shims'),
      profiles: { powershell: [], bash: [bashProfile] },
      backupDir: path.join(root, 'backups'),
    });
    assert.strictEqual(result.profiles[0].action, 'installed');
    const content = fs.readFileSync(bashProfile, 'utf8');
    /* El contenido del usuario queda intacto (con el backtick literal). */
    assert.ok(content.includes(userLine), 'el backtick+n no debe tocarse en bash');
  });

  test('stripGuardBlocks elimina un marcador start huérfano (bloque truncado)', async () => {
    const root = target();
    const profile = path.join(root, 'profile.ps1');
    fs.writeFileSync(profile, `linea1\n${PROFILE_MARKER_START}\nsin fin de bloque\nexport FOO=1\n`, 'utf8');
    const result = await installProfiles({
      shimDir: path.join(root, 'shims'),
      profiles: { powershell: [profile], bash: [] },
      backupDir: path.join(root, 'backups'),
    });
    assert.strictEqual(result.profiles[0].action, 'updated');
    const content = fs.readFileSync(profile, 'utf8');
    /* Un solo bloque nuevo: el marcador huérfano se limpió y no hay dobles. */
    assert.strictEqual(content.split(PROFILE_MARKER_START).length - 1, 1);
    assert.ok(content.includes('linea1'));
    assert.ok(content.includes('export FOO=1'));
    /* El contenido del usuario fuera del bloque no se borra (el resto tras
     * el marcador huérfano es ambiguo y se conserva intacto). */
    assert.ok(content.includes('sin fin de bloque'));
  });

  test('backups de perfiles con mismo basename no colisionan', async () => {
    const root = target();
    const ps7 = path.join(root, 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    const ps5 = path.join(root, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
    fs.mkdirSync(path.dirname(ps7), { recursive: true });
    fs.mkdirSync(path.dirname(ps5), { recursive: true });
    fs.writeFileSync(ps7, 'PS7 original\n', 'utf8');
    fs.writeFileSync(ps5, 'PS5 original\n', 'utf8');
    const backupDir = path.join(root, 'backups');
    await installProfiles({
      shimDir: path.join(root, 'shims'),
      profiles: { powershell: [ps7, ps5], bash: [] },
      backupDir,
    });
    const backups = fs.readdirSync(backupDir).filter(name => name.endsWith('.backup'));
    assert.strictEqual(backups.length, 2, 'cada perfil conserva su propio backup');
    const contents = backups.map(name => fs.readFileSync(path.join(backupDir, name), 'utf8'));
    assert.ok(contents.includes('PS7 original\n'));
    assert.ok(contents.includes('PS5 original\n'));
  });
});
