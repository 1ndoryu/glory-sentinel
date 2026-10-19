/* Reglas Rust (orquestador: ejecuta las reglas Rust sobre cada documento.) Extraído de rustAnalyzer.ts. */
import { Violacion } from '../../../types';
import { CoreTextDocument } from '../../../core/runtime-proyecto/types';
import { reglaHabilitada } from '../../../config/ruleRegistry';
import { calcularRangosTest, esRutaDeTestRust } from '../rustTestScope';
import { analizarReglasNuevas } from '../reglas/rustReglasNuevas';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { detectarUnwrap, detectarPanic } from './rustPanicUnwrap';
import { detectarHandlerAccedeBd, detectarBroadcastMutex } from './rustPatronesLinea';
import { analizarFunciones } from './rustFunciones';
import { detectarRutaParametroSintaxis } from './rustAxumRutas';

/* Ejecuta todas las reglas Rust contextuales sobre un documento .rs */
export function analizarRust(documento: CoreTextDocument): Violacion[] {
  const texto = documento.getText();
  const lineas = texto.split('\n');
  const rutaNorm = documento.fileName.replace(/\\/g, '/');

  /* Excluir archivos de tests dedicados y examples.
   * [16A-8] `esRutaDeTestRust` cubre las DOS convenciones por ruta: `tests/`
   * (integracion del crate) y `<mod>/tests.rs` (modulo de tests partido a
   * fichero, que era el hueco: 103 de los 109 `expect` reportados en KAMPLES
   * salian de ahi). Antes solo se miraba `'/tests/'`, que no casa con
   * `.../bpm/tests.rs` porque el nombre es `tests.rs`, no un fichero DENTRO de
   * un directorio `tests`. */
  if (rutaNorm.includes('/examples/') || esRutaDeTestRust(rutaNorm)) {
    return [];
  }

  /* Soporte sentinel-disable-file global para todo el analyzer */
  if (tieneSentinelDisableFile(texto, 'rust-analyzer')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  /* Paso 1: Determinar que rangos de lineas son codigo de test.
   * Detecta #[cfg(test)] mod tests { ... } y funciones #[test]. */
  const rangoTests = calcularRangosTest(lineas);

  /* Paso 2: Reglas por linea con contexto test */
  if (reglaHabilitada('unwrap-produccion-rs')) {
    violaciones.push(...detectarUnwrap(lineas, rangoTests, texto));
  }

  if (reglaHabilitada('panic-produccion-rs')) {
    violaciones.push(...detectarPanic(lineas, rangoTests, texto));
  }

  /* Paso 3: Handler accede BD (solo para archivos en handlers/) */
  if (reglaHabilitada('handler-accede-bd-rs') && rutaNorm.includes('/handlers/')) {
    violaciones.push(...detectarHandlerAccedeBd(lineas, rangoTests, texto));
  }

  /* Paso 4: Funciones largas y parametros excesivos */
  if (reglaHabilitada('funcion-larga-rs') || reglaHabilitada('parametros-excesivos-rs')) {
    violaciones.push(...analizarFunciones(lineas, rangoTests, texto));
  }

  /* [096A] Paso 5: broadcast::Mutex — detectar uso de tokio::sync::broadcast
   * broadcast::Sender::send() usa std::sync::Mutex interno. Bajo contencion
   * (multiples sends al mismo canal), bloquea OS threads de tokio workers.
   * Incidente 096A: 15+ caidas, 13 fixes, root cause fue este Mutex. */
  if (reglaHabilitada('broadcast-mutex-riesgo-rs')) {
    violaciones.push(...detectarBroadcastMutex(lineas, rangoTests, texto));
  }

  /* [297A-14] Paso 6: sintaxis de parametros de ruta axum (version-aware:
   * matchit 0.7 (axum 0.7) parsea `:param`; matchit 0.8 (axum 0.8+) parsea
   * `{param}`. Sin evidencia del stack se conserva el comportamiento legacy
   * (flaggear `{param}`: el caso historicamente roto). */
  if (reglaHabilitada('axum-ruta-sintaxis-rs')) {
    violaciones.push(...detectarRutaParametroSintaxis(lineas, texto, documento.fileName));
  }

  /* [059A-S7] Pasos 7-8: hornadas de reglas nuevas (orquestador en
   * rustReglasNuevas.ts por budget ADR 0001; 149A-1 añade la segunda hornada). */
  violaciones.push(...analizarReglasNuevas(lineas, rangoTests, texto, documento.fileName));

  return violaciones;
}
