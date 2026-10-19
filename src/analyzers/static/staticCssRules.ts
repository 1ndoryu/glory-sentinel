/*
 * Reglas CSS para el analyzer estatico (fachada): la logica vive en staticCss*.ts.
 * Mismos exports y mismo path para no tocar importadores.
 */
export { verificarNomenclaturaCssIngles } from './staticCssNomenclatura';
export { verificarCardIconoExtiendeBase, verificarCssAdhocButtonStyle } from './staticCssAdhoc';
export { verificarCssHardcoded } from './staticCssHardcoded';
export { verificarCssElementoHTMLDirecto } from './staticCssElementoHtml';

/* [15A-25] Movido a staticCssModalRules.ts por budget ADR 0001; se re-exporta
 * para no tocar importadores (staticAnalyzer, tests). */
export { verificarModalSemanticaNoCanonica } from './staticCssModalRules';
export { verificarCssEspecificacionDisenoLocal } from './staticCssDesignRules';
