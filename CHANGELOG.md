# Changelog
<!-- test de deteccion: 2026-02-20 -->

## [0.7.9] - 2026-09-10

### Corregido
- **FP-S3 (`expect-produccion-rs`):** el `.expect(..)` que acompaña al constructor de clave HMAC
  (`HmacSha256::new_from_slice`, `Hmac::<Sha512>::new_from_slice`, `SimpleHmac`, …) ya no se reporta.
  HMAC normaliza la clave de cualquier longitud (RFC 2104: la hashea si excede el bloque del digest y la
  rellena con ceros si es más corta), así que `InvalidLength` es inalcanzable y el `.expect(..)` es
  correcto, no un panic de producción. Era el único `expect` vivo del área y el mismo defecto en las tres
  copias del submódulo `glory-rs`. La exención exige un **tipo HMAC explícito**, de modo que
  `Aes256Gcm::new_from_slice(..)`/ChaCha20 —donde el fallo por longitud **sí** existe— siguen
  disparando, con test de sobre-exclusión que lo fija.
- Los overrides locales de timeout de la suite ya no pueden quedar por debajo del `timeout` de
  `.mocharc.json`. Tres suites (`taskCoordinator`, `lease`, `gateRun`) seguían fijando 30 s después de
  subir el config a 60 s, y como un override inferior **endurece** el techo del runner en silencio, el
  primer `quality:setup` de la campaña `039A-1` volvió a fallar de forma intermitente:
  `Timeout of 30000ms exceeded` en `taskCoordinator` — un test que hace ~25 operaciones git reales
  (`worktree add`, merge, cleanup) y tarda ~24 s, con lo que un techo de 30 s dejaba solo un 27 % de
  margen. Alineados a 60 s. El `timeout` del config queda documentado en el `README.md` como **suelo**:
  todo override local debe ser igual o mayor (los de 120 s y 180 s ya lo eran y se conservan).
- **El test `verify valida un proceso descendiente REAL del emisor` (`lease`) deja de ser flaky.** El
  fixture lanzaba un hijo con una vida de **5 s** y luego verificaba la cadena de procesos real; bajo la
  carga de la suite completa ese margen se agotaba y el hijo ya había muerto, así que la cadena no
  resolvía y el verificador fallaba cerrado con un falso `pid-no-descendiente`
  (`AssertionError: false !== true` en `lease.test.js`). El hijo pasa a vivir 120 s (el `finally` lo
  sigue matando), lo que elimina la carrera contra el reloj sin tocar el verificador.
- Las dos suites de `taskCoordinator.test.ts` suben a 180 s. Con el techo ya en 60 s, el perfil completo
  (591 tests, ~6-9 min) falló con `Timeout of 60000ms exceeded` en `aísla dos proyectos del mismo
  repositorio aunque compartan task-id` y en `editable true autoriza el cambio de un ignored-local…`, y la
  misma suite pasó **591 passing / 1 pending / 0 failing** en una segunda corrida sin tocar el código: los
  dos fallos son **intermitentes por carga**, no deterministas. Como la evidencia de release exige
  `suite: "passed"` reproducible, un techo con margen justo no sirve: se fija 180 s, el mismo criterio ya
  aplicado a `shellMatrix` (120 s) y `workspaceReport` (180 s) para los tests de I/O real.
- **FP-S1 (`inline-style-prohibido`): custom property con clave computada.** En TypeScript una custom
  property no puede escribirse como clave literal — `CSSProperties` no admite claves `--*` — así que la
  forma canónica es el índice computado, `style={{['--pixel-df' as string]: dimensiones}}`. La exención
  solo reconocía la clave literal (`'--x':`), de modo que ese objeto se reportaba como estilo inline real.
  Medido: `EditorPixelArt.tsx` de PROYECTO TASKS era el único caso vivo de la regla en el área (el segundo
  hallazgo, `mensajes.tsx`, es un `width:` real y se conserva). La exención acepta ahora `['--x' as T]:` y
  `['--x']:` y mantiene su condición fuerte: **todas** las propiedades del objeto deben ser custom
  properties, así que un índice computado que no se puede probar como custom property (`[clave]: valor`) y
  una mezcla con una propiedad real siguen reportándose, con tests de sobre-exclusión que lo fijan.
- La regla `inline-style-prohibido` ya no reporta un `style={{}}` escrito **dentro de un comentario**. Es
  un regex por línea, así que sin saltar comentarios un `style={{}}` dentro de `{/* … */}` o de un
  comentario de bloque contaba como estilo inline real. Se calculan los rangos comentados del archivo en
  una sola pasada —con seguimiento de comillas, para no confundir el `//` de una URL dentro de un string
  con un comentario— y el match se descarta si cae dentro de un rango. **Es una corrección preventiva: la
  medición del área no encontró ningún caso vivo** (el `{/* … */}` de `SelectorRepeticionPill.tsx` es un
  `style` real, un panel flotante posicionado por JS, y está correctamente silenciado con
  `sentinel-disable`). El salto se aplica **solo** a esta regla: generalizarlo al resto es un cambio de
  comportamiento que necesita su propio caso y su propia medición. Tests de sobre-exclusión fijan que un
  comentario cerrado no silencia el estilo real de la línea siguiente.

### Verificado sin cambios
- El presupuesto de **5000 ms** de `defaultParentPidOf` (resolución del padre real en Windows vía
  `Get-CimInstance`) se conserva: medido bajo la carga de la suite completa, un salto cuesta
  **0,7–1,2 s**, es decir ~4× de margen. El cuello de botella del test flaky de `lease` era la vida del
  proceso hijo, no este presupuesto.
- Los overrides de 120 s (`shellMatrix`) y 180 s (`workspaceReport`) se conservan: ya estaban por encima
  del `timeout` del config y son deliberados.
- Los dos hallazgos restantes de la regla en el área **no** son falsos positivos y se conservan: el
  `style={{width: …}}` de `mensajes.tsx` es un ancho dinámico real, y el `style={{position: 'fixed', …}}`
  de `SelectorRepeticionPill.tsx` es un panel flotante posicionado por JS (silenciado con
  `sentinel-disable`, que la regla respeta).

## [0.7.8] - 2026-09-10

### Agregado
- Reglas de análisis solo-código (se saltan tests, fixtures y ejemplos) y nuevas reglas Rust
  `expect-produccion-rs`, `block-on-produccion-rs` y `lock-await-produccion-rs` (059A-S1/S7).
- `unwrap-produccion-rs` y las reglas nuevas ignoran archivos solo-test declarados con
  `#![cfg(test)]`, incluidos los módulos de tests partidos a fichero propio (902c45e, 1587c59):
  36 falsos positivos menos.
- `axum-ruta-sintaxis-rs` resuelve el stack por versión (`matchit`/`axum` del `Cargo.lock`), de modo
  que no reporta falsos positivos en axum 0.8+; la resolución se extrajo a `rustAxumStack.ts` para
  respetar el budget del ADR 0001 (08aaf25, 6baf87c).

### Corregido
- `.mocharc.json` fija `timeout: 60000` y `src/test/suite/index.ts` usa el mismo valor. Con 10 s, los
  tests de fixture real (`git init`/`commit` + spawn del CLI, 2-25 s por caso) morían por timeout de
  Mocha antes de agotar el `timeout: 60_000` que el propio test declara en su `spawnSync`, es decir
  el límite del runner quedaba por debajo del que el test consideraba suficiente. El perfil headless
  `npm run test:unit` vuelve a ser verde (585 passing, 0 failing) y `quality:setup` puede certificar
  `suite: "passed"` para los consumidores que fijan este commit.

## [0.7.4] - 2026-08-12

### Corregido
- La matriz de guards y los tests de coordinación son portables en runners POSIX: rutas temporales,
  separadores y mensajes ya no asumen Windows.
- El guard PowerShell resuelve ejecutables sin extensión `.exe` cuando corre sobre PowerShell 7 en Linux.
- La CI publica los nombres y mensajes de los fallos de Mocha como anotaciones y artefacto descargable.

## [0.7.1] - 2026-08-11

### Corregido
- `sentinel init --json` aplica el bootstrap igual que la salida de texto; `--json` cambia solo la representación.
- Los conflictos existentes conservan salida y código de error sin sobrescribir archivos del proyecto.
- Prueba de CLI real para config, lock y `init-manifest`: 8 casos PASS.

## [0.7.0] - 2026-08-10

### Agregado
- Merge de la auditoría 108A-1 (rama `f1/cli-contracts`) sobre `main` 0.6.4: contratos CLI corregidos (logger siempre a stderr, stdout reservado al JSON), `doctor` separa `readyForAnalyze` de `readyForGate`, `check --dry-run` estrictamente no mutante, budgets conectados (`quality:profile --budgets`), `sentinel init/migrate/uninit` con presets node/rust/python/mixed, Sentinel como producto único (ADR 0001: registro de extensiones, fronteras `check:core`, CLI dividido en args/commands, capabilities opcionales) y endurecimiento de seguridad/concurrencia (path containment, redacción, locks atómicos con verificación de ownership, fixtures de seguridad). Suite upstream: 557 passing.
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
