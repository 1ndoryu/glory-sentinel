/*
 * Fachada del analyzer Glory.
 * Coordina los submodulos: schemaLoader, islandTracker,
 * glorySchemaRules, glorySecurityRules, gloryQualityRules y defaultContentRules.
 *
 * Antes: 1460 lineas monoliticas. Ahora: fachada ~70 lineas.
 */

import * as path from 'path';
import { Violacion } from '../types';
import { reglaHabilitada } from '../config/ruleRegistry';
import { esRutaGlory, normalizarRuta } from '../utils/analisisHelpers';
import { CoreRutasGlory, CoreTextDocument } from '../core/runtime-proyecto/types';
import { configurarWorkspaceRoots } from '../core/seguridad-rutas/workspaceRoots';
import { detectarPerfilProyecto } from '../core/perfil/perfilProyecto';
import { AjustesProyecto, AJUSTES_PROYECTO_DEFECTO } from './ajustesProyecto';

/* Submodulos */
import { cargarSchema, obtenerMapaCols, obtenerMapaEnums } from './glory/schema/schemaLoader';
import { cargarIslasRegistradas, verificarIslaNoRegistrada } from './glory/calidad/islandTracker';
import { verificarHardcodedSqlColumn, verificarHardcodedEnumValue, verificarSelectStar } from './glory/schema/glorySchemaRules';
import { verificarEndpointAccedeBd, verificarIntervalSinWhitelist, verificarOpenRedirect } from './glory/calidad/glorySecurityRules';
import { verificarReturnVoidCritico, verificarNPlus1Query, verificarFqnInline, verificarPhpSinReturnType } from './glory/calidad/gloryQualityRules';
import { verificarDefaultContentClaves, REGLA_IDS_DEFAULT_CONTENT } from './glory/calidad/defaultContentRules';
import { cargarIndiceConstantes, obtenerIndiceConstantes } from './glory/constantes/phpConstantIndexer';
import { verificarUndefinedClassConstant } from './glory/constantes/gloryConstantRules';
import { cargarContratos, configurarRutasControllers, obtenerContratos } from './glory/api/apiContractIndexer';
import { verificarApiResponseMismatch } from './glory/api/apiContractRules';
import { cargarTipos } from './glory/schema/tsTypeResolver';
import { verificarArrayAsociativoComoLista, verificarServiceRetornaAsociativo } from './php/phpArrayShapeRules';

/* [SQ-3] Glory solo actúa en proyectos Glory: sin perfil ni rutasGlory no se indexa nada
 * y sus reglas EsquemaProyecto (antes GlorySchema) se saltan. Las reglas genéricas (SeguridadSql, estructura) siguen igual. */
let gloryActivo = false;

export function estaGloryActivo(): boolean {
  return gloryActivo;
}

/*
 * Inicializa el analyzer Glory: recibe raices de workspace y carga indices.
 * `rutasGlory` (sentinel.config.json) fija las carpetas de controllers antes de indexar; ausente = defaults.
 * `activo` false = no indexar (el workspace no es un proyecto Glory). Los watchers viven en platform/vscode/gloryAnalyzerAdapter.ts.
 */
export function inicializarGloryAnalyzer(workspaceRoots: string[], rutasGlory: CoreRutasGlory | undefined, activo: boolean): void {
  gloryActivo = activo;
  configurarWorkspaceRoots(workspaceRoots);
  if (!activo) { return; }
  configurarRutasControllers(rutasGlory?.controladores);
  cargarSchema();
  cargarIslasRegistradas();
  cargarIndiceConstantes();
  cargarContratos();
  cargarTipos();
}

/*
 * Decide la activación con el perfil de cada raíz: basta un proyecto Glory o un rutasGlory declarado.
 * Usar esta función en vez de inicializarGloryAnalyzer evita activar Glory en proyectos ajenos.
 */
export async function inicializarGloryParaWorkspaces(workspaceRoots: string[], rutasGlory?: CoreRutasGlory): Promise<void> {
  const perfiles = await Promise.all(workspaceRoots.map(raiz => detectarPerfilProyecto(raiz)));
  const activo = rutasGlory !== undefined || perfiles.some(perfil => perfil.glory);
  inicializarGloryAnalyzer(workspaceRoots, rutasGlory, activo);
}

/*
 * Punto de entrada del analyzer Glory.
 * Ejecuta verificaciones habilitadas segun tipo de archivo.
 */
export function analizarGlory(documento: CoreTextDocument, ajustes: AjustesProyecto = AJUSTES_PROYECTO_DEFECTO): Violacion[] {
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
  const glory = estaGloryActivo();

  /* Reglas TSX/JSX */
  /* Reglas TSX/JSX/TS (services, hooks, islands) */
  if (extension === '.tsx' || extension === '.jsx' || extension === '.ts') {
    /* isla-no-registrada: solo aplica a islands (.tsx/.jsx) */
    if (glory && (extension === '.tsx' || extension === '.jsx') && reglaHabilitada('isla-no-registrada')) {
      violaciones.push(...verificarIslaNoRegistrada(rutaNormalizada, texto, ajustes));
    }
    /* Contrato API: cruzar claves TS vs PHP — aplica a services (.ts) e islands (.tsx) */
    if (glory && reglaHabilitada('api-response-mismatch') && obtenerContratos()) {
      violaciones.push(...verificarApiResponseMismatch(lineas));
    }
    /* Shape mismatch: api-shape-mismatch se detecta dentro de verificarApiResponseMismatch */
    return violaciones;
  }

  /* Reglas PHP */
  if (extension !== '.php') { return violaciones; }

  /* Asegurar que el schema este cargado */
  if (glory && !obtenerMapaCols() && !obtenerMapaEnums()) {
    cargarSchema();
  }

  /* Sprint 1: Schema enforcement */
  if (glory && reglaHabilitada('hardcoded-sql-column') && obtenerMapaCols()) {
    violaciones.push(...verificarHardcodedSqlColumn(lineas, rutaNormalizada));
  }
  if (glory && reglaHabilitada('hardcoded-enum-value') && obtenerMapaEnums()) {
    violaciones.push(...verificarHardcodedEnumValue(lineas, rutaNormalizada));
  }
  if (glory && reglaHabilitada('endpoint-accede-bd')) {
    violaciones.push(...verificarEndpointAccedeBd(lineas, rutaNormalizada, ajustes));
  }
  if (glory && reglaHabilitada('interval-sin-whitelist')) {
    violaciones.push(...verificarIntervalSinWhitelist(lineas));
  }
  if (glory && reglaHabilitada('open-redirect')) {
    violaciones.push(...verificarOpenRedirect(lineas));
  }

  /* Glory/ es framework externo  estas reglas no aplican a su codigo */
  if (glory && reglaHabilitada('return-void-critico') && !esRutaGlory(rutaNormalizada, ajustes.marcadoresGlory)) {
    violaciones.push(...verificarReturnVoidCritico(texto, lineas));
  }

  /* Sprint 3: calidad de codigo */
  if (reglaHabilitada('n-plus-1-query')) {
    violaciones.push(...verificarNPlus1Query(lineas, rutaNormalizada));
  }
  if (reglaHabilitada('controller-fqn-inline') && !esRutaGlory(rutaNormalizada, ajustes.marcadoresGlory)) {
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
    REGLA_IDS_DEFAULT_CONTENT.filter(id => glory && reglaHabilitada(id))
  );
  if (reglasDefaultContent.size > 0) {
    violaciones.push(...verificarDefaultContentClaves(lineas, reglasDefaultContent));
  }

  /* Constantes de clase indefinidas */
  if (glory && reglaHabilitada('undefined-class-constant') && obtenerIndiceConstantes()) {
    violaciones.push(...verificarUndefinedClassConstant(lineas));
  }

  /* Sprint 11: Array shapes — detectar arrays asociativos que deberian ser listas */
  if (reglaHabilitada('php-array-asociativo-como-lista')) {
    violaciones.push(...verificarArrayAsociativoComoLista(lineas));
  }
  if (reglaHabilitada('php-service-retorna-asociativo') && !esRutaGlory(rutaNormalizada, ajustes.marcadoresGlory)) {
    violaciones.push(...verificarServiceRetornaAsociativo(lineas));
  }

  return violaciones;
}
