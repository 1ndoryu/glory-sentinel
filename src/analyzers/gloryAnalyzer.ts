/*
 * Fachada del analyzer Glory.
 * Coordina los submodulos: schemaLoader, islandTracker,
 * glorySchemaRules, glorySecurityRules, gloryQualityRules y defaultContentRules.
 *
 * Antes: 1460 lineas monoliticas. Ahora: fachada ~70 lineas.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Violacion } from '../types';
import { reglaHabilitada } from '../config/ruleRegistry';
import { normalizarRuta } from '../utils/analisisHelpers';

/* Submodulos */
import { inicializarSchemaWatcher, cargarSchema, obtenerMapaCols, obtenerMapaEnums } from './glory/schemaLoader';
import { inicializarIslasWatcher, verificarIslaNoRegistrada } from './glory/islandTracker';
import { verificarHardcodedSqlColumn, verificarHardcodedEnumValue, verificarSelectStar } from './glory/glorySchemaRules';
import { verificarEndpointAccedeBd, verificarIntervalSinWhitelist, verificarOpenRedirect } from './glory/glorySecurityRules';
import { verificarReturnVoidCritico, verificarNPlus1Query, verificarFqnInline, verificarPhpSinReturnType } from './glory/gloryQualityRules';
import { verificarDefaultContentClaves, REGLA_IDS_DEFAULT_CONTENT } from './glory/defaultContentRules';

/*
 * Inicializa el analyzer Glory: carga schema, islas y watchers.
 * Llamar una sola vez desde extension.ts al activar.
 */
export function inicializarGloryAnalyzer(context: vscode.ExtensionContext): void {
  inicializarSchemaWatcher(context);
  inicializarIslasWatcher(context);
}

/*
 * Punto de entrada del analyzer Glory.
 * Ejecuta verificaciones habilitadas segun tipo de archivo.
 */
export function analizarGlory(documento: vscode.TextDocument): Violacion[] {
  const texto = documento.getText();
  const lineas = texto.split('\n');
  const rutaArchivo = documento.fileName;
  const violaciones: Violacion[] = [];

  /* Excluir archivos auto-generados y prototipos de referencia */
  const rutaNormalizada = normalizarRuta(rutaArchivo);
  if (rutaNormalizada.includes('_generated/')) { return []; }
  const nombreBase = path.basename(rutaArchivo, path.extname(rutaArchivo));
  if (nombreBase === 'ejemplo' || nombreBase === 'example') { return []; }

  const extension = path.extname(rutaArchivo).toLowerCase();

  /* Reglas TSX/JSX */
  if (extension === '.tsx' || extension === '.jsx') {
    if (reglaHabilitada('isla-no-registrada')) {
      violaciones.push(...verificarIslaNoRegistrada(rutaNormalizada, texto));
    }
    return violaciones;
  }

  /* Reglas PHP */
  if (extension !== '.php') { return violaciones; }

  /* Asegurar que el schema este cargado */
  if (!obtenerMapaCols() && !obtenerMapaEnums()) {
    cargarSchema();
  }

  /* Sprint 1: Schema enforcement */
  if (reglaHabilitada('hardcoded-sql-column') && obtenerMapaCols()) {
    violaciones.push(...verificarHardcodedSqlColumn(lineas, rutaNormalizada));
  }
  if (reglaHabilitada('hardcoded-enum-value') && obtenerMapaEnums()) {
    violaciones.push(...verificarHardcodedEnumValue(lineas, rutaNormalizada));
  }
  if (reglaHabilitada('endpoint-accede-bd')) {
    violaciones.push(...verificarEndpointAccedeBd(lineas, rutaNormalizada));
  }
  if (reglaHabilitada('interval-sin-whitelist')) {
    violaciones.push(...verificarIntervalSinWhitelist(lineas));
  }
  if (reglaHabilitada('open-redirect')) {
    violaciones.push(...verificarOpenRedirect(lineas));
  }

  /* Glory/ es framework externo  estas reglas no aplican a su codigo */
  if (reglaHabilitada('return-void-critico') && !rutaNormalizada.includes('/Glory/')) {
    violaciones.push(...verificarReturnVoidCritico(texto, lineas));
  }

  /* Sprint 3: calidad de codigo */
  if (reglaHabilitada('n-plus-1-query')) {
    violaciones.push(...verificarNPlus1Query(lineas, rutaNormalizada));
  }
  if (reglaHabilitada('controller-fqn-inline') && !rutaNormalizada.includes('/Glory/')) {
    violaciones.push(...verificarFqnInline(lineas));
  }
  if (reglaHabilitada('php-sin-return-type')) {
    violaciones.push(...verificarPhpSinReturnType(lineas));
  }
  if (reglaHabilitada('repository-sin-whitelist-columnas')) {
    violaciones.push(...verificarSelectStar(lineas, rutaNormalizada));
  }

  /* Sprint 6: claves incorrectas en DefaultContentManager::define() */
  const reglasDefaultContent = new Set(
    REGLA_IDS_DEFAULT_CONTENT.filter(id => reglaHabilitada(id))
  );
  if (reglasDefaultContent.size > 0) {
    violaciones.push(...verificarDefaultContentClaves(lineas, reglasDefaultContent));
  }

  return violaciones;
}
