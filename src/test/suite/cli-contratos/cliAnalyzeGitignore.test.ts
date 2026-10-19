import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeCliTarget, parseCliArgs } from '../../../cli';
import { globDeGitignore } from '../../../cli/comandos/cliAnalyze';
import { tempDir } from '../../temporales';

suite('Sentinel CLI: recorrido sin git aplica .gitignore', () => {
  test('traduce las líneas de .gitignore a globs', () => {
    assert.strictEqual(globDeGitignore('dist/'), '**/dist');
    assert.strictEqual(globDeGitignore('/out'), 'out');
    assert.strictEqual(globDeGitignore('desktop/ui/dist/'), 'desktop/ui/dist');
    assert.strictEqual(globDeGitignore('# comentario'), null);
    assert.strictEqual(globDeGitignore('!keep.ts'), null);
    assert.strictEqual(globDeGitignore('   '), null);
  });

  test('un workspace sin .git no analiza lo que su .gitignore ignora', async () => {
    const workspace = tempDir('sentinel-gitignore-');
    const escribir = (rel: string) => {
      fs.mkdirSync(path.dirname(path.join(workspace, rel)), { recursive: true });
      fs.writeFileSync(path.join(workspace, rel), 'export const v = 1;\n', 'utf8');
    };
    fs.writeFileSync(path.join(workspace, '.gitignore'), '# build\ndist/\n/generado.ts\n', 'utf8');
    escribir('a.ts');
    escribir('dist/bundle.ts');
    escribir('sub/dist/otro.ts');
    escribir('generado.ts');
    escribir('sub/generado.ts');
    escribir('sub/d.ts');

    try {
      const result = await analyzeCliTarget(parseCliArgs([
        'analyze', '--workspace', workspace, '--format', 'json',
      ]));
      /* [por que] Quedan a.ts, sub/generado.ts (el ancla /generado.ts solo vale en la raíz) y sub/d.ts. */
      assert.strictEqual(result.totalArchivos, 3);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
