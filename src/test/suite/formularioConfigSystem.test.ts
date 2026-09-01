import * as assert from 'assert';
import { verificarFormularioConfigSinSistema } from '../../analyzers/react/formularioConfigSystem';
import { verificarCssHardcoded } from '../../analyzers/static/staticCssRules';

function crearDocumento(fileName: string) {
  return { fileName } as any;
}

suite('formulario-config-sin-sistema-declarativo', () => {
  test('detecta modal de config manual con >=3 campos nativos', () => {
    const texto = [
      "import { useState } from 'react';",
      '',
      'export function ModalConfigManual() {',
      '  const [a, setA] = useState("");',
      '  return (',
      '    <div>',
      '      <input value={a} onChange={(e) => setA(e.target.value)} />',
      '      <input placeholder="b" />',
      '      <select><option>1</option></select>',
      '      <button onClick={fn}>Guardar</button>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const violaciones = verificarFormularioConfigSinSistema(texto.split('\n'), 'ModalConfigManual.tsx');

    assert.strictEqual(violaciones.length, 1);
    assert.strictEqual(violaciones[0]?.reglaId, 'formulario-config-sin-sistema-declarativo');
    assert.match(violaciones[0]?.mensaje || '', /FormCampo/);
  });

  test('no flaggea modal que importa el sistema declarativo', () => {
    const texto = [
      "import { FormularioConfiguracion } from '../shared';",
      '',
      'export function ModalConfigBien() {',
      '  return (',
      '    <FormularioConfiguracion especificacion={[]} valores={{}} alCambiar={() => {}} />',
      '  );',
      '}',
    ].join('\n');
    const violaciones = verificarFormularioConfigSinSistema(texto.split('\n'), 'ModalConfigBien.tsx');

    assert.strictEqual(violaciones.length, 0);
  });

  test('no flaggea archivos fuera del patron de nombre', () => {
    const texto = [
      'export function Dashboard() {',
      '  return (',
      '    <div>',
      '      <input />',
      '      <input />',
      '      <input />',
      '      <button>x</button>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const violaciones = verificarFormularioConfigSinSistema(texto.split('\n'), 'Dashboard.tsx');

    assert.strictEqual(violaciones.length, 0);
  });

  test('respeta sentinel-disable-file de la regla', () => {
    const texto = [
      '/* sentinel-disable-file formulario-config-sin-sistema-declarativo */',
      "import { useState } from 'react';",
      '',
      'export function ModalConfigManual() {',
      '  return (',
      '    <div>',
      '      <input />',
      '      <input />',
      '      <select><option>1</option></select>',
      '      <button>x</button>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const violaciones = verificarFormularioConfigSinSistema(texto.split('\n'), 'ModalConfigManual.tsx');

    assert.strictEqual(violaciones.length, 0);
  });

  test('no flaggea con menos de 3 campos', () => {
    const texto = [
      'export function ModalConfigChico() {',
      '  return (',
      '    <div>',
      '      <input />',
      '      <button>x</button>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const violaciones = verificarFormularioConfigSinSistema(texto.split('\n'), 'ModalConfigChico.tsx');

    assert.strictEqual(violaciones.length, 0);
  });

  test('no flaggea componentes del sistema (Input/Select/Textarea/Boton) en minuscula-pattern', () => {
    const texto = [
      "import { Input } from '../ui/Input';",
      "import { Select } from '../ui/Select';",
      "import { Boton } from '../ui/Boton';",
      '',
      'export function SeccionConfigPerfil() {',
      '  return (',
      '    <div>',
      '      <Input tipo="text" />',
      '      <Input tipo="password" />',
      '      <Input tipo="password" />',
      '      <Select />',
      '      <Boton>Guardar</Boton>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const violaciones = verificarFormularioConfigSinSistema(texto.split('\n'), 'SeccionConfigPerfil.tsx');

    /* [318A-4-fix] El patron es case-sensitive: los componentes capitalizados del sistema
       (patron twin-class §12.2) NO son campos nativos. */
    assert.strictEqual(violaciones.length, 0);
  });

  test('no flaggea el propio FormCampo', () => {
    const texto = ['export function FormCampo() {', '  return <input />;', '}'].join('\n');
    const violaciones = verificarFormularioConfigSinSistema(texto.split('\n'), 'FormCampo.tsx');

    assert.strictEqual(violaciones.length, 0);
  });
});

suite('css-hardcoded-value (reactivada 318A-4)', () => {
  test('detecta color hex fuera de tokens', () => {
    const texto = [
      '.panel { background: #f0f0f0; }',
    ].join('\n');
    const violaciones = verificarCssHardcoded(texto, crearDocumento('/repo/frontend/src/components/panel/Panel.css'), 'Panel.css');

    assert.strictEqual(violaciones.length, 1);
    assert.strictEqual(violaciones[0]?.reglaId, 'css-hardcoded-value');
  });

  test('no flaggea variables.css ni bloques :root', () => {
    const texto = [
      ':root {',
      '  --color-fondo: #f0f0f0;',
      '}',
    ].join('\n');
    const violacionesRoot = verificarCssHardcoded(texto, crearDocumento('/repo/frontend/src/styles/variables.css'), 'variables.css');
    const violacionesNoRoot = verificarCssHardcoded(texto, crearDocumento('/repo/frontend/src/components/panel/Panel.css'), 'Panel.css');

    assert.strictEqual(violacionesRoot.length, 0);
    assert.strictEqual(violacionesNoRoot.length, 0);
  });

  test('no flaggea lineas con var() ni definiciones de variable', () => {
    const texto = [
      '.panel { color: var(--texto-primario); }',
      '--variable-sueltas: red;',
    ].join('\n');
    const violaciones = verificarCssHardcoded(texto, crearDocumento('/repo/frontend/src/components/panel/Panel.css'), 'Panel.css');

    assert.strictEqual(violaciones.length, 0);
  });

  test('detecta rgb/rgba hardcodeado', () => {
    const texto = [
      '.boton { background: rgba(10, 10, 10, 0.5); }',
    ].join('\n');
    const violaciones = verificarCssHardcoded(texto, crearDocumento('/repo/frontend/src/components/ui/Boton.css'), 'Boton.css');

    assert.strictEqual(violaciones.length, 1);
    assert.strictEqual(violaciones[0]?.reglaId, 'css-hardcoded-value');
  });
});