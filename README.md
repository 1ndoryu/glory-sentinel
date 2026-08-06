# Glory Sentinel

![Portada Glory Sentinel](media/7599515f2b8981a49a057e0e9a75b8b6.jpg)

Glory Sentinel (Code Sentinel) es el plano de control de calidad agnóstico del ecosistema Glory: una extensión de VS Code, un CLI y un LSP con reglas estáticas que detectan problemas reales de arquitectura, seguridad y mantenimiento en Rust, PHP/WordPress, React/TypeScript y CSS.

> **v0.4.0 eliminó el análisis IA.** Toda la detección es estática y determinista: no requiere red, claves, modelo externo ni backend. CLI, LSP y VS Code consumen el mismo motor (`src/core`) y el mismo registro de reglas (`src/config/ruleRegistry.ts`), de modo que producen hallazgos equivalentes. El checkout `main` publicado conserva el analizador `sentinel analyze`; el plano global (`check`, `guard`, `doctor`, `status`, `lease` y `task`) vive en el release coordinado más reciente y debe publicarse/fijarse como un commit posterior, nunca asumirse por el número `0.4.0`.

> **Regla de compatibilidad:** `sentinel --version` informa la versión del paquete, no garantiza capacidades del plano global. Para conocer lo que realmente soporta una instalación usa `sentinel --help` y `sentinel doctor --json`. Un consumidor debe fijar el commit exacto en su lock; no basta con fijar `0.4.0`.

## Estado publicado y desarrollo del plano global

El `main` público de `glory-sentinel` puede estar temporalmente detrás del checkout coordinador del consumidor. Por eso este README se mantiene veraz para ambos casos:

- **Release analizador 0.4.0:** `analyze`, `--files-from`, configuración estricta del analizador (`includePatterns`, `excludePatterns`, `directoryExceptions`, `portableBoundaries`, `rules`) y salida JSON v1.
- **Release coordinado:** añade `check`, `guard`, `doctor`, `status`, `install`, `update`, `rollback`, `uninstall`, `lease` y `task`, además de `project.primaryBranch` y el envelope v2 del consumidor.

No copies el `sentinel.config.json` v2 de un consumidor a una instalación que solo expone el release analizador. Si `--help` no muestra `task`, esa instalación no puede coordinar worktrees; usa `analyze` o actualiza desde un artefacto/release que declare esa capacidad.

Para que Sentinel funcione en cualquier carpeta, el consumidor debe llevar su propia política y lock en la raíz del proyecto. La rama primaria es dato del consumidor y no se fija en Sentinel ni en una skill global.

### Instalación reproducible del release coordinado

Desde el checkout del release coordinado (o desde un artefacto publicado equivalente):

```bash
npm install
npm run compile
node out/cli/index.js --help
node out/cli/index.js doctor --json --workspace /ruta/al/proyecto
node out/cli/index.js install --source-root . --with-shims --with-path
```

El instalador global no debe copiar solo `out/`: debe incluir `package.json` y las dependencias de runtime, calcular y registrar `artifactSha256`, y verificar el hash después de instalar. Tras actualizar una instalación existente, abre una shell nueva y repite `sentinel --version`, `sentinel --help` y `sentinel doctor --json`.

El coordinador `task` solo está disponible cuando `--help` lo lista. Para un proyecto sin Git o sin `project.primaryBranch`, usa `analyze`; `task` falla cerrado en vez de inventar `main`.

## Comandos mínimos portables

```bash
# Analizar cualquier carpeta sin depender de cwd ni de una rama concreta
sentinel analyze --workspace /ruta/al/proyecto --format json

# Diagnóstico de una instalación y del proyecto detectado
sentinel doctor --json --workspace /ruta/al/proyecto
```

Para añadir el plano coordinado a un proyecto nuevo no se copia `quality-tools.json` o `project.primaryBranch` desde otro proyecto: se genera una configuración local, se fija el commit publicado de Sentinel y se ejecuta el lock-check del consumidor.

## Compatibilidad de capacidades

Antes de usar una orden avanzada, comprueba la ayuda: un binario que solo muestra `analyze` es un analizador 0.4.0 válido, pero no es el runtime coordinador. El número de versión compartido no sustituye al commit/protocolo fijado.

### Contrato mínimo del analizador 0.4.0

La configuración estricta del analizador acepta únicamente estas claves en su raíz:

```json
{
  "includePatterns": [],
  "excludePatterns": [],
  "directoryExceptions": [],
  "portableBoundaries": {},
  "rules": {}
}
```

Las claves `schemaVersion`, `mode`, `project`, `gate`, `guard`, `runtime` y `analyzers` pertenecen al envelope v2 del release coordinado; no se deben mezclar con el release analizador.

### Migración sin sorpresas

1. Ejecuta `sentinel --help` y guarda la lista de comandos.
2. Ejecuta `sentinel --version` y `sentinel doctor --json`.
3. Si falta `task`/`check`, instala un release coordinado publicado y verifica de nuevo; no cambies el JSON del proyecto para esconder el desfase.
4. Fija commit, hash y capacidades en el lock del consumidor.
5. Solo entonces habilita `sentinel task` o `sentinel check`.

La fuente de verdad de una capacidad es el binario/commit realmente fijado; README, skills y ramas locales no la crean.

## Nota de publicación

Un commit coordinador en un submódulo detached no se publica automáticamente. El mantenedor de `glory-sentinel` debe integrar los commits coordinados en `main`/release, actualizar el README/CHANGELOG/help del repositorio publicado y crear un tag o artefacto reproducible. Después, cada consumidor actualiza su gitlink/lock y regenera el runtime global. Hasta ese momento, documentar el commit como `consumer-only` y no afirmar que `0.4.0` contiene `task`.

## ¿Qué resuelve?

- Detecta violaciones de seguridad y robustez antes de que lleguen a producción.
- Señala deuda técnica estructural (archivos monolito, SRP, malas prácticas recurrentes).
- Aporta feedback rápido mientras editas, sin depender de una revisión manual completa.
- En el release coordinado 0.5.0 también proporciona `check`, `guard`, `doctor`, `status`, leases y coordinación de tareas; el consumidor mantiene la política y el lock en su propia raíz.

## Superficies

| Superficie | Descripción |
|------------|-------------|
| **Extensión VS Code** | Diagnósticos en vivo mientras editas (PHP, TS/TSX, JS, CSS/SCSS, Rust) |
| **CLI `sentinel`** | `sentinel analyze` con salida Markdown/JSON y soporte `--files-from` para alcance incremental |
| **LSP `sentinel-lsp`** | Servidor stdio editor-agnóstico; integrable en Zed u otros editores |

## Análisis estático en tiempo real

- Límites de tamaño por tipo de archivo (componentes, hooks, utils) y directorios abarrotados.
- Patrones prohibidos (`eval`, supresores `@`, catches vacíos, secretos hardcodeados, `git add .`).
- SQL seguro: `$wpdb->query/get_var/get_row/get_results` sin `prepare()`, TOCTOU select-insert, N+1, `SELECT *` sin whitelist de columnas.
- Ejecución de procesos: `exec()`/`shell_exec()` sin `escapeshellarg()`; procesos externos con `shell:true` o argumentos concatenados.
- Reglas React/TS (mutación directa de estado, efectos sin cleanup, exceso de `useState`, Zustand sin selector, modales/menús artesanales).
- Reglas PHP/WordPress (controllers sin try-catch, `json_decode` inseguro, inputs sin filtrar, `curl_exec` sin verificación, archivos temporales y locks sin `finally`).
- Reglas Rust SOLID (`unwrap()`/`panic!` en producción, handlers que acceden a BD, `broadcast::Sender` bajo contención, rutas axum con `{param}` en vez de `:param`).
- Reglas portables de arquitectura configuradas por boundaries (DOM/window/API/logger fuera de su capa).
- Contrato API: mismatch de claves y de shape PHP↔TS que causan `h.map is not a function` en React.
- Glory Schema: claves incorrectas en `DefaultContentManager::define()` que producen pérdida silenciosa de datos.

## Orquestación universal de tareas

Sentinel también coordina trabajo paralelo sin compartir un checkout mutable: cada tarea obtiene un
ownership atómico y un `git worktree`/rama exclusiva. La integración nunca hace push, reset, force ni
commit implícito; exige target limpio, base estable, worktree limpio y `--ff-only`. Los worktrees
temporales se crean dentro de `<repo>/.sentinel/worktrees/`; una ruta solicitada fuera de esa raíz se
rechaza para que los agentes no tengan que salir de `la raíz del proyecto consumidor`. Si aparecen
conflictos, el agente debe actualizar su rama desde la rama principal declarada en `project.primaryBranch`,
resolver y revisar cada conflicto en su worktree, ejecutar el gate, commitear la resolución y
reintentar. Sentinel no resuelve conflictos a ciegas, pero una tarea no se considera terminada mientras
tenga conflictos o una rama pendiente. Toda tarea terminada se integra en la rama principal declarada
por el proyecto; no existe un target alternativo para cerrar una tarea. En este repositorio esa rama es
La rama primaria es siempre dato del consumidor; nunca se asume `main` ni el nombre de otro proyecto. Una excepción solo puede quedar como bloqueo documentado
por una decisión explícita del usuario, nunca como tarea terminada. Después, `cleanup` retira el worktree,
la rama y la metadata y se verifica que
no quedan recursos de la tarea. El estado vive en `<repo>/.sentinel/coordination/` y los worktrees en `<repo>/.sentinel/worktrees/`;
son temporales, están ignorados por Git y no se integran en la rama del proyecto.

```bash
sentinel task claim GAME-01 --project-root . --agent agent-a
sentinel task start <TASK-ID> --project-root . --agent agent-a --primary-branch <primary-branch>
sentinel task heartbeat <TASK-ID> --project-root . --agent agent-a
sentinel task gate <TASK-ID> --project-root ./.sentinel/worktrees/repo-<project-identity>-GAME-01 --agent agent-a
sentinel task integrate <TASK-ID> --project-root . --agent agent-a --target <primary-branch>
sentinel task cleanup <TASK-ID> --project-root . --agent agent-a
sentinel task release <TASK-ID> --project-root . --agent agent-a
```

`claim` concurrente para el mismo ID y proyecto deja un único ganador. Proyectos distintos se aíslan por la identidad derivada del Git common dir y `project.primaryBranch`: pueden usar el mismo ID simultáneamente, con ramas `task/<project-identity>/<id>`, worktrees y status separados. Una toma expirada requiere takeover
explícito (`--force`) y no puede robar recursos aún registrados. `cleanup --force` solo recupera una
tarea expirada si su proceso emisor ya no vive y el árbol está limpio; el estado reporta metadata
inválida, ramas/worktrees huérfanos y locks expirados. El coordinador funciona con Git y Node, no
conoce el stack del consumidor; cada proyecto fija únicamente el commit de Sentinel. La validación de
worktrees internos requiere consumir un commit de Sentinel que ya incluya este contrato; una copia
modificada localmente o esta documentación por sí sola no habilita la capacidad en un clon limpio.

## Resolución universal del guard en shells y cwd anidados

Los interceptores generados por `sentinel install/update --with-shims` nunca construyen la ruta del guard desde el directorio actual. En `cmd`, el shim estándar resuelve `current.js` relativo a `%~dp0` (la ubicación real del shim); en Bash y PowerShell usa la ruta absoluta del runtime. El cwd solo se envía como `--project-root` para descubrir la política del proyecto. Por eso `npm --prefix <proyecto> run dev`, Vite y sus procesos hijos pueden arrancar desde un subdirectorio sin buscar `quality-command-guard.mjs` dentro de ese cwd.

Si un equipo conserva shims antiguos o launchers propios en `PATH`, debe ejecutar una actualización del runtime para regenerarlos:

```bash
sentinel update --with-shims --with-profiles --with-path
```

La actualización es idempotente y no requiere copiar `scripts/quality` de un repositorio concreto. Un clon consumidor solo obtiene esta corrección cuando fija un commit de Sentinel que la contiene y regenera su lock del quality gate.

## CLI

```bash
# Análisis de todo el workspace (salida Markdown en stdout)
sentinel analyze --workspace . --format markdown

# Análisis de un archivo puntual
sentinel analyze --file src/app.ts --format json

# Alcance incremental: lee archivos relativos al workspace, uno por línea
sentinel analyze --workspace . --files-from .changed-files --format json

# Con configuración explícita y salida a archivo
sentinel analyze --workspace . --config sentinel.config.json --output .sentinel-report.md
```

| Opción | Descripción |
|--------|-------------|
| `--workspace <path>` | Analiza un workspace (por defecto: cwd) |
| `--file <path>` | Analiza un archivo puntual (excluye `--workspace`/`--files-from`) |
| `--files-from <path>` | Lee archivos relativos al workspace, uno por línea |
| `--format <type>` | `markdown` \| `json` (por defecto: markdown) |
| `--output <path>` | Escribe la salida en archivo; si falta, imprime en stdout |
| `--config <path>` | Carga `sentinel.config.json` |
| `--help` / `--version` | Ayuda / versión instalada |

### Códigos de salida y contrato JSON

| Código | Significado |
|--------|-------------|
| `0` | Análisis sin errores |
| `1` | Hay hallazgos con severidad error |
| `2` | Error de ejecución (config inválida, path inexistente, etc.) |

La salida JSON usa `schemaVersion: '1'` y normaliza los hallazgos con `reglaId`, `severidad`, `linea`, `columna`, `mensaje` y `sugerencia`, para que el gate y otros consumidores no dependan del formato de texto.

## Configuración

### `sentinel.config.json` (CLI y LSP)

Configuración estricta y versionada en la raíz del proyecto. **Las claves desconocidas, las reglas desconocidas y las severidades inválidas hacen fallar la validación** (no se ignoran silenciosamente).

```json
{
  "includePatterns": ["**/*.rs", "frontend/**/*.ts", "frontend/**/*.css"],
  "excludePatterns": ["**/node_modules/**", "**/target/**", "**/generated/**"],
  "directoryExceptions": ["migrations", "scripts"],
  "portableBoundaries": {
    "dom": ["/platform/", "/adapters/"],
    "window": ["/platform/", "/navigation/"],
    "services": ["/services/", "/api/", "/repositories/"],
    "loggerModules": ["/logger.", "/logging/"]
  },
  "rules": {
    "barras-decorativas": { "habilitada": false },
    "catch-vacio": { "severidad": "warning" }
  }
}
```

| Clave | Tipo | Descripción |
|-------|------|-------------|
| `includePatterns` | `string[]` | Globs a analizar (defaults por lenguaje) |
| `excludePatterns` | `string[]` | Globs a excluir |
| `directoryExceptions` | `string[]` | Directorios exentos de `directorio-abarrotado` |
| `portableBoundaries` | `object` | Boundaries de las reglas portables (`dom`/`window`/`services`/`loggerModules`) |
| `rules` | `object` | Overrides por ID de regla: `{ "habilitada": boolean, "severidad": "error"\|"warning"\|"information"\|"hint" }` |

### `settings.json` de VS Code

| Clave | Default | Descripción |
|-------|---------|-------------|
| `codeSentinel.staticAnalysis.enabled` | `true` | Habilitar análisis estático |
| `codeSentinel.timing.staticDebounce` | `1` | Debounce en segundos al editar |
| `codeSentinel.rules` | `{}` | Overrides por ID de regla (mismo formato que el JSON) |
| `codeSentinel.reportPath` | `.sentinel-report.md` | Ruta del reporte al analizar workspace |
| `codeSentinel.exclude` | globs estándar | Exclusiones adicionales |
| `codeSentinel.directoryExceptions` | `[]` | Directorios exentos de `directorio-abarrotado` |
| `codeSentinel.languages` | 8 lenguajes | Lenguajes donde se activa el análisis |

## Reporte de workspace

Al ejecutar "Analizar Workspace" (o `sentinel analyze --output`), se genera el reporte con:
- Conteo de violaciones por severidad (error / warning / information / hint).
- Tabla por archivo con línea, regla y mensaje, ordenada por gravedad.
- Configurable vía `codeSentinel.reportPath` o `--output`.

## Archivos excluidos del análisis

Por defecto se excluyen automáticamente:

- `**/node_modules/**`, `**/vendor/**`
- `**/dist/**`, `**/out/**`, `**/build/**`, `**/target/**`
- `**/_generated/**`
- `**/.vitepress/cache/**`
- `**/.agent/**`, `**/scripts/**`

Puedes añadir exclusiones adicionales con `codeSentinel.exclude` o `excludePatterns` del JSON.

## Comandos disponibles (VS Code)

| Comando | Descripción |
|---------|-------------|
| `Glory Sentinel: Analizar Archivo Actual` | Fuerza análisis completo del archivo activo |
| `Glory Sentinel: Analizar Workspace` | Escanea el workspace y genera reporte |
| `Glory Sentinel: Limpiar Diagnosticos` | Limpia todos los diagnósticos |
| `Glory Sentinel: Ver Resumen de Reglas` | Muestra reglas activas con estado habilitada/deshabilitada |
| `Glory Sentinel: Ejecutar Lint y Type-Check` | Ejecuta las herramientas externas del gate (Sentinel/VarSense/type-check) |

## Configurar reglas por ID

Puedes deshabilitar reglas individualmente o cambiar su severidad:

```json
{
  "codeSentinel.rules": {
    "barras-decorativas": { "habilitada": false },
    "catch-vacio": { "severidad": "warning" },
    "hardcoded-secret": { "severidad": "error" }
  }
}
```

### IDs de reglas disponibles

Fuente de verdad: `src/config/ruleRegistry.ts` (copia fijada en `quality-tools.json`). `nomenclatura-css-ingles` y `default-export` vienen desactivadas por defecto; `css-hardcoded-value` está comentada en el registry.

#### Patrones prohibidos

| ID | Default |
|----|---------|
| `php-supresor-at` | error |
| `at-generico-php` | warning |
| `eval-prohibido` | error |
| `innerhtml-variable` | warning |
| `catch-vacio` | error |
| `hardcoded-secret` | error |
| `git-add-all` | warning |
| `exec-sin-escapeshellarg` | error |
| `console-generico-en-catch` | warning |
| `mime-type-cliente` | error |
| `emoji-en-codigo` | warning |
| `console-production` (portable) | warning |
| `unsafe-process-shell` (portable) | error |

#### Seguridad SQL

| ID | Default |
|----|---------|
| `wpdb-sin-prepare` | error |
| `toctou-select-insert` | error |
| `query-doble-verificacion` | information |
| `n-plus-1-query` | warning |
| `repository-sin-whitelist-columnas` | hint |

#### PHP / WordPress

| ID | Default |
|----|---------|
| `controller-sin-trycatch` | warning |
| `request-json-directo` | warning |
| `json-decode-inseguro` | warning |
| `curl-sin-verificacion` | warning |
| `temp-sin-finally` | warning |
| `sanitizacion-faltante` | warning |
| `lock-sin-finally` | error |
| `catch-critico-solo-log` | warning |
| `cadena-isset-update` | warning |
| `json-sin-limite-bd` | warning |
| `retorno-ignorado-repo` | warning |
| `php-sin-return-type` | hint |
| `php-array-asociativo-como-lista` | warning |
| `php-service-retorna-asociativo` | warning |

#### React / TypeScript

| ID | Default |
|----|---------|
| `usestate-excesivo` | warning |
| `useeffect-sin-cleanup` | warning |
| `mutacion-directa-estado` | warning |
| `zustand-sin-selector` | warning |
| `error-enmascarado` | error |
| `zustand-objeto-selector` | warning |
| `key-index-lista` | hint |
| `componente-sin-hook-glory` | warning |
| `promise-sin-catch` | warning |
| `useeffect-dep-inestable` | hint |
| `html-nativo-en-vez-de-componente` | warning |
| `button-clase-especifica` | warning |
| `modal-con-titulo` | warning |
| `modal-acciones-no-canonico` | warning |
| `modal-estructura-no-canonica` | warning |
| `menu-contextual-override-diseno` | warning |
| `componente-artesanal` | warning |
| `fallo-sin-feedback` | warning |
| `update-optimista-sin-rollback` | warning |
| `fetch-sin-timeout` | hint |
| `listen-sin-cleanup` | warning |
| `status-http-generico` | warning |
| `handler-sin-trycatch` | warning |
| `cola-sin-limite` | warning |
| `objeto-mutable-exportado` | hint |
| `acceso-api-sin-fallback` | warning |
| `inline-style-prohibido` | warning |
| `dom-access-outside-platform` (portable) | warning |
| `window-reference-outside-platform` (portable) | warning |
| `singleton-mutable-state` (portable) | warning |

#### Glory Schema / Contrato API

| ID | Default |
|----|---------|
| `hardcoded-sql-column` | warning |
| `hardcoded-enum-value` | warning |
| `endpoint-accede-bd` | warning |
| `interval-sin-whitelist` | error |
| `open-redirect` | error |
| `return-void-critico` | warning |
| `isla-no-registrada` | warning |
| `glory-meta-clave-incorrecta` | error |
| `glory-slug-clave-incorrecta` | error |
| `glory-titulo-clave-incorrecta` | error |
| `glory-imagen-clave-incorrecta` | warning |
| `glory-galeria-clave-incorrecta` | warning |
| `glory-contenido-clave-incorrecta` | warning |
| `undefined-class-constant` | error |
| `api-response-mismatch` | error |
| `api-shape-mismatch` | error |
| `api-call-outside-service` (portable) | warning |

#### Rust SOLID

| ID | Default |
|----|---------|
| `unwrap-produccion-rs` | warning |
| `panic-produccion-rs` | warning |
| `handler-accede-bd-rs` | warning |
| `funcion-larga-rs` | warning |
| `parametros-excesivos-rs` | hint |
| `broadcast-mutex-riesgo-rs` | error |
| `axum-ruta-sintaxis-rs` | error |

#### Estructura, nomenclatura y límites

| ID | Default |
|----|---------|
| `limite-lineas` | warning |
| `limite-lineas-nivel-2` | warning |
| `limite-lineas-nivel-3` | error |
| `limite-lineas-nivel-4` | error |
| `directorio-abarrotado` | warning |
| `barras-decorativas` | information |
| `import-muerto` | warning |
| `any-type-explicito` | hint |
| `controller-fqn-inline` | hint |
| `todo-pendiente` | hint |
| `non-null-assertion-excesivo` | hint |
| `nomenclatura-css-ingles` (desactivada) | hint |
| `card-icono-debe-extender-base` | warning |
| `modal-semantica-no-canonica` | warning |
| `css-elemento-html-directo` | warning |
| `css-especificacion-diseno-local` | warning |
| `default-export` (desactivada, portable) | hint |
| `mixed-barrel-logic` (portable) | warning |
| `large-interface-isp` (portable) | hint |

## Lógica contextual — sin falsos positivos

Las siguientes reglas usan análisis de ventana de líneas en lugar de regex puro:

**`wpdb-sin-prepare`** — No reporta:
- `$wpdb->query('START TRANSACTION')`, `ROLLBACK`, `COMMIT`, `SAVEPOINT`
- DDL: `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`, `TRUNCATE`
- `$wpdb->get_row($wpdb->prepare(...))` — `prepare()` anidado como argumento
- Queries sin cláusulas que acepten input de usuario (`WHERE`, `JOIN`, `HAVING`, `SET`, `VALUES`)
- Variables construidas con `prepare()` hasta 50 líneas antes

**`controller-sin-trycatch`** -- No reporta:
- Metodos de registro de rutas: `registerRoutes()`, `register()`
- Permission callbacks: metodos `can*`, `verificar*`, `checkPermission*` (WordPress gestiona sus errores)
- Clases que usan `use ConCallbackSeguro` (el trait ya envuelve handlers en try-catch)
- Metodos triviales con menos de 5 lineas efectivas

**`exec-sin-escapeshellarg`** — No reporta:
- `proc_open($array, ...)` — array literal como primer argumento
- `proc_open($var, ...)` cuando `$var` fue definida como array en líneas cercanas

## Reglas portables de arquitectura

Detecciones de bajo acoplamiento que reciben sus boundaries por configuración (`portableBoundaries`): el núcleo no conoce la estructura de ningún proyecto. Reportan warning/hint y dejan la decisión de bloqueo a la política del consumidor.

| ID | Qué detecta | Default |
|----|-------------|---------|
| `dom-access-outside-platform` | Acceso DOM directo fuera del boundary de plataforma | warning |
| `window-reference-outside-platform` | Referencia `window` fuera del boundary de navegación | warning |
| `api-call-outside-service` | Llamada API fuera de un service/adaptador declarado | warning |
| `console-production` | `console.*` en código de producción fuera del logger | warning |
| `unsafe-process-shell` | Proceso externo con `shell:true` o argumentos concatenados | error |
| `default-export` | Default export en módulo de aplicación (desactivada por defecto) | hint |
| `singleton-mutable-state` | Estado mutable exportado a nivel de módulo | warning |
| `mixed-barrel-logic` | Barrel que mezcla re-export y lógica ejecutable | warning |
| `large-interface-isp` | Interface con más de 10 campos (posible violación de ISP) | hint |

## Supresión puntual de reglas

Para suprimir una regla en una línea concreta:

```php
/* sentinel-disable-next-line regla-id */
```

O en línea (misma línea que el código):

```php
$codigo; /* sentinel-disable regla-id */
```

Para excluir un archivo completo de una regla (justificando por regla, archivo, tarea y fecha de retirada):

```php
/* sentinel-disable-file limite-lineas */
```

## Desarrollo local

```bash
cd <sentinel-checkout>
npm install
npm run compile        # genera out/ (extensión + CLI + LSP)
node out/cli/index.js --version
```

Luego presiona `F5` en VS Code para abrir un `Extension Development Host`.

**Binarios** (declarados en `package.json`): `sentinel` → `out/cli/index.js`; `sentinel-lsp` → `out/lsp/server.js`.
