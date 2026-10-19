/*
 * [114A-6] Analyzer contextual para Rust.
 * Detecta violaciones SOLID y de seguridad que requieren contexto
 * mas alla de regex por linea: bloques #[cfg(test)], rutas de archivo,
 * conteo de lineas por funcion, conteo de parametros.
 *
 * Reglas implementadas:
 * - unwrap-produccion-rs: .unwrap() fuera de bloques test
 * - panic-produccion-rs: panic!/todo!/unimplemented! fuera de tests
 * - handler-accede-bd-rs: sqlx::query en handlers/ (viola DIP)
 * - funcion-larga-rs: funciones > 100 lineas efectivas
 * - parametros-excesivos-rs: funciones con 6+ parametros
 * - axum-ruta-sintaxis-rs: sintaxis {param}/:param incorrecta para el stack
 *   axum/matchit resuelto (version-aware; legacy ante stack desconocido)
 */

export { analizarRust } from './analisis/rustOrquestador';
