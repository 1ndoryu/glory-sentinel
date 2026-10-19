/*
 * Barrel de reglas de arquitectura de componentes React. Sin logica: cada regla
 * vive en su modulo hermano por responsabilidad. Este path se conserva para que
 * los importadores (reactAnalyzer, tests) no cambien.
 */

export { configurarWorkspaceRootsReact, obtenerWorkspaceRootsReact } from './reactUiCatalog';
export {
  verificarModalConTitulo,
  verificarModalAccionesNoCanonico,
  verificarModalEstructuraNoCanonica,
} from './reactModalRules';
export {
  verificarMutacionDirectaEstado,
  verificarUpdateOptimistaSinRollback,
  verificarColaSinLimite,
  verificarObjetoMutableExportado,
} from './reactEstadoRules';
export { verificarKeyIndexLista, verificarComponenteSinHook } from './reactEstructuraRules';
export {
  esWrapperSistemaDiseno,
  esDisparadorDisclosure,
  verificarHtmlNativoEnVezDeComponente,
  verificarButtonClaseEspecifica,
} from './reactNativoRules';
export { verificarComponenteArtesanal, verificarMenuContextualOverride } from './reactOverlayRules';
