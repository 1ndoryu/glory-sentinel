/*
 * Fachada del analyzer React.
 * Coordina los submodulos: reactHookRules, reactErrorRules, reactComponentRules.
 *
 * Antes: 1082 lineas monoliticas. Ahora: fachada ~85 lineas.
 */

import * as path from 'path';
import { Violacion } from '../../types';
import { CoreTextDocument } from '../../core/runtime-proyecto/types';
import { reglaHabilitada } from '../../config/ruleRegistry';
import { esRutaGlory, indiceProyecto, proyectoTieneModalCanonico } from '../../utils/analisisHelpers';
import { AjustesProyecto, AJUSTES_PROYECTO_DEFECTO } from '../ajustesProyecto';

/* Submodulos */
import {
  verificarUseEffectSinCleanup,
  verificarUseEffectDepInestable,
  verificarZustandSinSelector,
  verificarZustandObjetoSelector,
  verificarListenSinCleanup,
} from './reglas/reactHookRules';
import {
  verificarConsoleEnCatch,
  verificarErrorEnmascarado,
  verificarPromiseSinCatch,
  verificarFalloSinFeedback,
  verificarFetchSinTimeout,
  verificarStatusHttpGenerico,
  verificarHandlerSinTryCatch,
} from './reglas/reactErrorRules';
import {
  verificarMutacionDirectaEstado,
  verificarKeyIndexLista,
  verificarComponenteSinHook,
  esWrapperSistemaDiseno,
  verificarHtmlNativoEnVezDeComponente,
  verificarButtonClaseEspecifica,
  verificarComponenteArtesanal,
  verificarUpdateOptimistaSinRollback,
  verificarColaSinLimite,
  verificarObjetoMutableExportado,
  verificarModalConTitulo,
  verificarModalAccionesNoCanonico,
  verificarModalEstructuraNoCanonica,
  verificarMenuContextualOverride,
  configurarWorkspaceRootsReact,
  configurarBasesUiReact,
  obtenerWorkspaceRootsReact,
} from './reglas/reactComponentRules';
import { verificarFormularioConfigSinSistema } from './formularioConfigSystem';
import { verificarAccesoApiSinFallback } from '../glory/api/apiFallbackRules';

export interface ReactAnalysisOptions {
  workspaceRoots?: string[];
  /* Carpetas del design system (rutasGlory.carpetasUi); ausente = defaults. */
  carpetasUi?: string[][];
  /* Marcadores Glory y exenciones del proyecto; sin valor usa los de por defecto. */
  ajustes?: AjustesProyecto;
}

/*
 * Analiza un archivo React en busca de violaciones especificas.
 * Complementa al staticAnalyzer con detecciones mas contextuales.
 */
export function analizarReact(documento: CoreTextDocument, opciones: ReactAnalysisOptions = {}): Violacion[] {
  configurarWorkspaceRootsReact(opciones.workspaceRoots ?? []);
  configurarBasesUiReact(opciones.carpetasUi);
  const texto = documento.getText();
  const lineas = texto.split('\n');
  const nombreArchivo = path.basename(documento.fileName);
  const violaciones: Violacion[] = [];

  /* Excluir prototipos de referencia */
  const nombreBase = nombreArchivo.replace(/\.[^.]+$/, '');
  if (nombreBase === 'ejemplo' || nombreBase === 'example') {
    return violaciones;
  }

  const ajustes = opciones.ajustes ?? AJUSTES_PROYECTO_DEFECTO;

  /* Determinar si el archivo pertenece a Glory/ (muchas reglas lo excluyen) */
  const enGlory = esRutaGlory(documento.fileName, ajustes.marcadoresGlory);

  /* desktop/ tiene sus propios componentes, no comparte componentes UI de la webapp */
  const enDesktop = documento.fileName.replace(/\\/g, '/').includes('/desktop/');

  /* Sprint 1  Hooks */
  if (reglaHabilitada('useeffect-sin-cleanup')) {
    violaciones.push(...verificarUseEffectSinCleanup(lineas));
  }
  if (reglaHabilitada('mutacion-directa-estado')) {
    violaciones.push(...verificarMutacionDirectaEstado(lineas));
  }
  if (reglaHabilitada('zustand-sin-selector')) {
    violaciones.push(...verificarZustandSinSelector(lineas));
  }
  if (reglaHabilitada('console-generico-en-catch')) {
    violaciones.push(...verificarConsoleEnCatch(lineas));
  }
  if (reglaHabilitada('error-enmascarado')) {
    violaciones.push(...verificarErrorEnmascarado(lineas));
  }

  /* Sprint 2 */
  if (reglaHabilitada('zustand-objeto-selector')) {
    violaciones.push(...verificarZustandObjetoSelector(lineas));
  }
  if (reglaHabilitada('useeffect-dep-inestable')) {
    violaciones.push(...verificarUseEffectDepInestable(lineas));
  }

  /* Reglas que excluyen Glory/ y desktop/ — usan guard centralizado */
  if (!enGlory && !enDesktop) {
    if (reglaHabilitada('key-index-lista')) {
      violaciones.push(...verificarKeyIndexLista(lineas));
    }
    if (reglaHabilitada('componente-sin-hook-glory')) {
      violaciones.push(...verificarComponenteSinHook(lineas, nombreArchivo));
    }
    if (reglaHabilitada('promise-sin-catch')) {
      violaciones.push(...verificarPromiseSinCatch(lineas));
    }
    if (reglaHabilitada('html-nativo-en-vez-de-componente') && !esWrapperSistemaDiseno(documento.fileName)) {
      violaciones.push(...verificarHtmlNativoEnVezDeComponente(lineas, nombreArchivo, ajustes));
    }
    if (reglaHabilitada('formulario-config-sin-sistema-declarativo')) {
      violaciones.push(...verificarFormularioConfigSinSistema(lineas, nombreArchivo));
    }
    if (reglaHabilitada('button-clase-especifica')) {
      violaciones.push(...verificarButtonClaseEspecifica(lineas, nombreArchivo));
    }
    if (reglaHabilitada('componente-artesanal')) {
      violaciones.push(...verificarComponenteArtesanal(lineas, nombreArchivo));
    }
    if (reglaHabilitada('fallo-sin-feedback')) {
      violaciones.push(...verificarFalloSinFeedback(lineas));
    }
    if (reglaHabilitada('update-optimista-sin-rollback')) {
      violaciones.push(...verificarUpdateOptimistaSinRollback(lineas));
    }
    if (reglaHabilitada('fetch-sin-timeout')) {
      violaciones.push(...verificarFetchSinTimeout(lineas, nombreArchivo));
    }
    if (reglaHabilitada('handler-sin-trycatch')) {
      violaciones.push(...verificarHandlerSinTryCatch(lineas));
    }
    if (reglaHabilitada('cola-sin-limite')) {
      violaciones.push(...verificarColaSinLimite(lineas));
    }
    if (reglaHabilitada('objeto-mutable-exportado')) {
      violaciones.push(...verificarObjetoMutableExportado(lineas));
    }
    if (reglaHabilitada('modal-con-titulo')) {
      violaciones.push(...verificarModalConTitulo(lineas));
    }
    if (reglaHabilitada('modal-acciones-no-canonico')) {
      /* [15A-25] Coste con cache; solo se calcula si la regla esta habilitada. */
      violaciones.push(...verificarModalAccionesNoCanonico(lineas, obtenerWorkspaceRootsReact()));
    }
    if (reglaHabilitada('modal-estructura-no-canonica')) {
      /* [119A-4 S4] Coste con cache; solo se calcula si la regla esta habilitada. */
      const tieneModalCanonico = proyectoTieneModalCanonico(obtenerWorkspaceRootsReact());
      /* [15A-25] Un <Modal className="X"> no redefine el contenedor: lo append. */
      const fusionaClassName = indiceProyecto(obtenerWorkspaceRootsReact()).modalFusionaClassName;
      violaciones.push(...verificarModalEstructuraNoCanonica(lineas, nombreArchivo, tieneModalCanonico, fusionaClassName));
    }
    if (reglaHabilitada('menu-contextual-override-diseno')) {
      violaciones.push(...verificarMenuContextualOverride(lineas, nombreArchivo));
    }
    if (reglaHabilitada('acceso-api-sin-fallback')) {
      violaciones.push(...verificarAccesoApiSinFallback(lineas));
    }
  }

  /* Reglas globales (no excluyen Glory) */
  if (reglaHabilitada('listen-sin-cleanup')) {
    violaciones.push(...verificarListenSinCleanup(lineas));
  }
  if (reglaHabilitada('status-http-generico')) {
    violaciones.push(...verificarStatusHttpGenerico(lineas));
  }

  return violaciones;
}
