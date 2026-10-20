/* [SQ-13] Consistencia de las listas del guard: defaults de fallback, presets
 * por stack y política del propio repo deben salir de la misma fuente y apuntar
 * a comandos que existen. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { BLOCKED_CARGO_COMMANDS, BLOCKED_NPM_SCRIPTS, BLOCKED_TOOLS } from '../../../core/guard/guardCommand';
import { LISTA_CARGO_COMMANDS, LISTA_NPM_SCRIPTS, LISTA_TOOLS } from '../../../core/guard/listasComandos';
import { STACK_PRESETS } from '../../../core/runtime-proyecto/init/presets';

/* Compilado: out/test/suite/guard → raíz del repo a cuatro niveles. */
const RAIZ = path.resolve(__dirname, '..', '..', '..', '..');

function contenidoEn(lista: readonly string[], valores: string[]): boolean {
  return valores.every(valor => lista.includes(valor));
}

suite('Sentinel core listas de comandos del guard (SQ-13)', () => {
  test('los defaults de fallback salen de la lista genérica única', () => {
    assert.strictEqual(BLOCKED_NPM_SCRIPTS, LISTA_NPM_SCRIPTS);
    assert.strictEqual(BLOCKED_TOOLS, LISTA_TOOLS);
    assert.strictEqual(BLOCKED_CARGO_COMMANDS, LISTA_CARGO_COMMANDS);
  });

  test('todo preset por stack declara solo comandos cubiertos por la lista genérica', () => {
    for (const [nombre, preset] of Object.entries(STACK_PRESETS)) {
      const { npmScripts, npxTools, cargoSubcommands } = preset.directCommands;
      assert.ok(contenidoEn(LISTA_NPM_SCRIPTS, npmScripts), `${nombre}: npmScripts fuera de la lista genérica`);
      assert.ok(contenidoEn(LISTA_TOOLS, npxTools), `${nombre}: npxTools fuera de la lista genérica`);
      assert.ok(contenidoEn(LISTA_CARGO_COMMANDS, cargoSubcommands), `${nombre}: cargoSubcommands fuera de la lista genérica`);
    }
  });

  test('la política del repo solo nombra scripts que existen en package.json', () => {
    const politica = JSON.parse(fs.readFileSync(path.join(RAIZ, 'sentinel.config.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
    const scripts = Object.keys(pkg.scripts ?? {});
    const npmScripts: string[] = politica.guard.directCommands.npmScripts;
    for (const script of npmScripts) {
      assert.ok(scripts.includes(script), `sentinel.config.json nombra "${script}" y package.json no lo define`);
    }
    assert.ok(contenidoEn(LISTA_TOOLS, politica.guard.directCommands.npxTools), 'npxTools del repo fuera de la lista genérica');
  });
});
