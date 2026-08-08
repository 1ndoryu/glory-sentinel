# Changelog
<!-- test de deteccion: 2026-02-20 -->

## [Unreleased] - 2026-08-08 (extensión local, sin publicar)

### Agregado
- Trazabilidad completa de tareas: `task status --all --json` conserva historial archivado tras `cleanup`/`release`, eventos del lifecycle, summary/plan/relaciones, resultados de gates, commits y archivos cambiados; detecta namespaces coordinados, worktrees/ramas huérfanos, locks expirados y carpetas físicas en raíces internas o externas autorizadas. La limpieza archiva solo después de retirar recursos con éxito y `release` rechaza metadata que aún conserva recursos.
- `task start --worktrees-root <dir>`: raíz externa autorizada para worktrees temporalmente visibles
  al workspace del agente (por ejemplo `area-trabajo/task-worktrees`). Debe existir, quedar fuera del
  repositorio y resolverse a un path físico real; el resto de rutas arbitrarias siguen bloqueadas. La
  metadata conserva la raíz usada para que cleanup/recover validen contención contra ella. `task gate`
  acepta worktrees vinculados externos (su top level es hermano de la raíz Git; la identidad sigue
  anclada al common dir del repositorio).
- Manifiesto de entorno (`sentinel.env-manifest.json` o `task start --env-manifest <path>`): la tarea
  declara qué necesita además del contenido versionado (`tracked`, `generated`, `ignored-local`,
  `external`, `secret`) y Sentinel provisiona las entradas `ignored-local` desde su fuente declarada
  (copia explícita aprobada) dentro del worktree antes de marcarlo ACTIVE. Si falta una fuente, la
  tarea falla con `missing-task-input` (ruta, categoría, origen esperado y acción requerida) y se
  revierte el worktree creado (sin huérfanos). Los secretos no pueden venir de un source del checkout;
  external/generated no se copian. Los provisionados son ignorados por Git, así que el worktree sigue
  limpio para gate/integrate; el manifiesto no puede pisar contenido tracked del worktree. `editable: true`
  autoriza cambios solo en esa entrada `ignored-local`; las demás quedan protegidas por hash. Sentinel
  captura una línea base hash de ignorados preexistentes y bloquea modificaciones/eliminaciones no
  autorizadas o nuevos paths ignorados en gate/integrate/cleanup. Rechaza manifiestos fuera del
  `projectRoot`, symlinks de escape y fuentes de directorio; `TaskRecord` v2 se migra a schema v3
  conservando la tarea.

## [0.6.4] - 2026-08-07

### Corregido
- Alinea la documentación pública con el paquete y el commit coordinado publicado.

## [0.6.3] - 2026-08-07

### Corregido
- `sentinel --version` y `doctor` resuelven la versión activa desde `current.json` cuando el CLI se ejecuta mediante un runtime instalado.
- `doctor` diferencia un gitlink preparado en el índice de un gitlink ausente en `HEAD` y expone ambos estados en el diagnóstico.



> **Deprecacion IA:** el motor de analisis IA via vscode.lm se elimino en 0.4.0; toda deteccion es estatica y determinista.
## [0.6.0] - 2026-08-07

### Agregado
- `sentinel doctor` fail-closed: diagnostica submódulo/gitlink, CLI y `--version`, package metadata/dependencias/scripts, capacidades CLI, symlink escapes, checkout/package-lock dirty, commits/versiones y coherencia de lock; el gate real falla cerrado antes de las etapas.
- Validación de release: el commit fijado debe ser alcanzable desde una ref de release permitida (`origin/main` o tag `v*`) y debe existir evidencia de compile + suite desde staging limpio (`.sentinel/release-evidence/`).
- Provisionamiento aislado: el CLI faltante se compila en staging temporal con entorno npm limpio; solo se materializan artefactos generados/ignorados y la evidencia queda ligada al commit.
- `task status` expone estado derivado `expired`/`processAlive`/`worktreeClean`; `task recover --dry-run/real` valida snapshots de metadata (`updatedAtMs`, PID, HEAD) antes del cleanup y escribe auditoría JSON.
- Capacidades declaradas: la ausencia de una capacidad se reporta como `tool-capability-missing` antes de ejecutar, no a mitad del proceso.

### Seguridad
- Detección de checkout/package-lock modificado (incluida instalación interrumpida) con rechazo salvo patch declarado; detección de symlink/junction que escapa del workspace.
- La recuperación de tareas exige tarea expirada, PID muerto, namespace, heads consistentes y worktree limpio; nunca borra recursos ajenos ni cambios no commiteados.

## [0.5.0] - 2026-08-06

### Agregado
- Coordinador universal `sentinel task` con claim atómico, un worktree/rama por tarea, heartbeat,
  gate delegado, integración `--ff-only`, takeover explícito de expirados y cleanup seguro.
- Diagnóstico JSON de metadata inválida, worktrees/ramas huérfanos y locks expirados.
- Runtime global versionado con `install`, `update`, `rollback` y `uninstall`, shims universales fuera del `cwd`, leases firmados y PATH/perfiles administrables.
- El coordinador deriva la rama primaria y la identidad del proyecto desde el checkout consumidor; no asume `main` ni nombres de otro proyecto.

### Seguridad
- Las operaciones concurrentes usan locks de directorio con takeover mediante `rename`; ningún
  proceso elimina directamente el lock de otro.
- La integración rechaza target/worktree sucios, base avanzada, ramas divergentes y worktrees no
  autorizados; no crea commits ni hace push/reset/force.

## [0.4.0] - 2026-07-29

### Agregado
- Contrato CLI automatizable con `--files-from`, `--help`, `--version` y JSON versionado con conteos por severidad.
- Validación estricta de `sentinel.config.json`, incluyendo reglas y claves desconocidas.
- Pruebas de alcance incremental y seguridad de rutas.
- Reglas portables de arquitectura por boundaries (portableRules.ts) y portableBoundaries en config.
- Reglas unsafe-process-shell y default-export (esta ultima desactivada por defecto) en el registry.

### Mejorado
- El núcleo permanece agnóstico; las políticas específicas de cada consumidor se declaran en su configuración local.

## [0.2.4] - 2026-05-09

### Mejorado
- `npm run test:unit` ejecuta `check:core` y falla si `src/core/**` importa `vscode` fuera de `vscodeAdapter.ts`, preservando la arquitectura editor-agnostica.

## [0.1.0] - 2026-02-19

### Implementado
- Motor de analisis estatico con 13 reglas regex
- Analyzer especializado PHP/WordPress (controllers, $wpdb, json_decode, exec, curl, tempfiles)
- Analyzer especializado React (useEffect cleanup, mutacion de estado, Zustand selectors, console en catch)
- Analyzer especializado CSS (colores hardcodeados, nomenclatura ingles, barras decorativas)
- Motor de analisis IA via `vscode.lm` API con prompts segmentados por tipo de archivo
- Sistema de debounce con cooldown configurable para analisis estatico e IA
- Cache de resultados por hash de contenido
- CodeActionProvider con quick fixes para 5 tipos de violaciones
- Comando de supresion de reglas por linea (`sentinel-disable-next-line`)
- 5 comandos: analizar archivo, analizar workspace, limpiar, toggle IA, resumen de reglas
- Panel webview con resumen de reglas activas
- Configuracion completa via settings.json
- Tests unitarios para lineCounter y regex patterns
