/*
 * Fachada del analyzer React.
 * Coordina los submodulos: reactHookRules, reactErrorRules, reactComponentRules.
 *
 * Antes: 1082 lineas monoliticas. Ahora: fachada ~85 lineas.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Violacion } from '../types';
import { reglaHabilitada } from '../config/ruleRegistry';
import { esRutaGlory } from '../utils/analisisHelpers';

/* Submodulos */
import {
  verificarUseEffectSinCleanup,
  verificarUseEffectDepInestable,
  verificarZustandSinSelector,
  verificarZustandObjetoSelector,
  verificarListenSinCleanup,
} from './react/reactHookRules';
import {
  verificarConsoleEnCatch,
  verificarErrorEnmascarado,
  verificarPromiseSinCatch,
  verificarFalloSinFeedback,
  verificarFetchSinTimeout,
  verificarStatusHttpGenerico,
  verificarHandlerSinTryCatch,
} from './react/reactErrorRules';
import {
  verificarMutacionDirectaEstado,
  verificarKeyIndexLista,
  verificarComponenteSinHook,
  verificarHtmlNativoEnVezDeComponente,
  verificarButtonClaseEspecifica,
  verificarComponenteArtesanal,
  verificarUpdateOptimistaSinRollback,
  verificarColaSinLimite,
  verificarObjetoMutableExportado,
  verificarModalConTitulo,
  verificarModalAccionesNoCanonico,
  verificarModalEstructuraNoCanonica,
} from './react/reactComponentRules';
import { verificarAccesoApiSinFallback } from './glory/apiContractRules';

/*
 * Analiza un archivo React en busca de violaciones especificas.
 * Complementa al staticAnalyzer con detecciones mas contextuales.
 */
export function analizarReact(documento: vscode.TextDocument): Violacion[] {
  const texto = documento.getText();
  const lineas = texto.split('\n');
  const nombreArchivo = path.basename(documento.fileName);
  const violaciones: Violacion[] = [];

  /* Excluir prototipos de referencia */
  const nombreBase = nombreArchivo.replace(/\.[^.]+$/, '');
  if (nombreBase === 'ejemplo' || nombreBase === 'example') {
    return violaciones;
  }

  /* Determinar si el archivo pertenece a Glory/ (muchas reglas lo excluyen) */
  const enGlory = esRutaGlory(documento.fileName);

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
    if (reglaHabilitada('html-nativo-en-vez-de-componente')) {
      violaciones.push(...verificarHtmlNativoEnVezDeComponente(lineas, nombreArchivo));
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
      violaciones.push(...verificarModalAccionesNoCanonico(lineas));
    }
    if (reglaHabilitada('modal-estructura-no-canonica')) {
      violaciones.push(...verificarModalEstructuraNoCanonica(lineas, nombreArchivo));
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
