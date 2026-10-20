/* [M-S10] Los ajustes del proyecto (exenciones) llegan a los analizadores por el pipeline,
 * no por estado de módulo: un análisis no hereda lo que configuró otro. */
import * as assert from 'assert';
import { CoreAnalysisConfig, createCoreDocument } from '../../../../core/runtime-proyecto/types';
import { analizarDocumento } from '../../../../analyzers/pipeline';

const ESTILO = '.ctaBotonPrimario { cursor: pointer; }';
const RUTA_FRAMEWORK = '/repo/glory-rs/frontend/estilos/Componentes.css';

function analizarCss(ruta: string, extra: Partial<CoreAnalysisConfig> = {}) {
  const document = createCoreDocument({ uri: `file://${ruta}`, fileName: ruta, languageId: 'css', content: ESTILO });
  const config: CoreAnalysisConfig = { enabled: true, includePatterns: [], excludePatterns: [], ruleOverrides: {}, ...extra };
  return analizarDocumento(document, config);
}

suite('ajustes del proyecto en el pipeline', () => {
  test('la exención del perfil glory de la config llega a los analizadores', () => {
    const sinPerfil = analizarCss(RUTA_FRAMEWORK);
    const conPerfil = analizarCss(RUTA_FRAMEWORK, { exenciones: { perfil: 'glory' } });
    assert.ok(sinPerfil.length > conPerfil.length);
  });

  test('un análisis con exenciones no deja estado para el siguiente sin config', () => {
    analizarCss(RUTA_FRAMEWORK, { exenciones: { perfil: 'glory' } });
    assert.ok(analizarCss(RUTA_FRAMEWORK).length > 0);
  });
});
