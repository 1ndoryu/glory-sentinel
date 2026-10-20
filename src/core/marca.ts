/* Nombres de carpeta que el runtime escribe fuera de los proyectos. Viven en
 * un único módulo para que el scheduler y el guard no diverjan. Cambiar un
 * valor deja huérfano el estado de instalaciones anteriores: los consumidores
 * leen estas rutas tal cual (los tests de scheduler y diagnose fijan los
 * valores). Los nombres de publicación y de repositorio están en package.json
 * y no se centralizan aquí. */
export const CARPETA_GUARD = 'glory-quality-guard';
export const CARPETA_TARGET = 'glory-target';
