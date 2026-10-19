# Roadmap — glory-sentinel

Meta activa: máxima calidad de Sentinel (arquitectura, repo limpio, instalación, CLI, docs, agnosticismo, coherencia, autogate).
Orden de ejecución: de arriba abajo. Cada bloque: probar en la 89, documentar, commitear, cerrar en `Agente/completados/`.

## Pendiente

- [x] **R2 Hallazgos aplazados de la revisión de terceros (2026-10-19, cerrado).** Lista viva en `Agente/planes/plan-revision-tercero-2026-10-19.md`. Hecho: release v0.7.26 (tag y CHANGELOG; README e `package-lock.json` alineados); rutas `/Glory/` centralizadas en `esRutaGlory` y configurables con `marcadoresGlory` (21071a6, ver docs/configuration.md); `rules` y el perfil documentados en `docs/configuration.md` (verificado en la 89: 919 passing, check:core y check:reglas rc 0); `extension.wasm` sale del repo (79904b3); `Agente/` fuera del repo (27fbcaa); agnosticismo: reglas WordPress/Glory desactivadas por defecto y recomendación al detectar el proyecto (`src/core/perfil/perfilProyecto.ts`, verificado en la 89: 918 passing, 0 failing); budget de `staticCodeRules.ts` fijado en 705 líneas (`scripts/module-budgets.json`, check:core rc 0).

- [ ] **S16 Lock de Sentinel en glory-sentinel.** El gate avisa «Sentinel sin lock en el proyecto, fijado 0.7.26». Pendiente: `node workspace-manager/scripts/quality/bump.mjs --tool sentinel --write` propaga el release a los 11 consumidores (pins, lock y gitlinks de otros proyectos); no se ha ejecutado sin confirmación de la usuaria. Varsense: sin `varsense.config.json` (gate: «varsense ausente»), aceptado.

- [ ] **S9 Autogate en Arranque.** El análisis se ejecuta bien en la 89 (`analyze`, ver S13), pero falta la ficha de Arranque / endpoint `POST /api/gate/analizar`. Bloqueo: cambio en workspace-manager (registro y backend), fuera de este repo.

- Gate de RESTAURANTE (10AA-3, 2026-10-19): Sentinel se ejecuta en la 89 desde `/var/tmp/gate-tools/sentinel` (archive de `b4d043b`, versión 0.7.26; el adaptador comprueba `.quality-pin` y `--version` antes de cada análisis), no desde `tools/sentinel` de los submódulos de la 89, que están sucios por otra sesión. Pendiente de quien lleva Sentinel: decidir si el submódulo de la 89 se fija a ese pin o el pin se declara de otra forma. No tocado desde RESTAURANTE.

### Backlog de la revisión de diez puntos (2026-10-19, diagnóstico previo a editar)
Orden de ejecución: T1 → T6. Cada bloque: probar en la 89, documentar en `Agente/completados/tareas-2026-10-19.md`, commit y push a main, `Arranque gate "glory-sentinel" --cierre`.

- [x] **T1 Contratos rotos (alto).** Hecho 2026-10-19.
  - Config v1: `validateSentinelConfig` acepta `schemaVersion` 1 (legado, reglas sueltas) y 2; 3 se rechaza. Ningún `sentinel.config.json` de `~/taller` usa v1 (comprobado).
  - Caché LSP: `invalidarIndiceProyecto()` en `src/utils/analisis/indiceProyecto.ts`, llamada desde `reloadWorkspaceIndexes` (`src/lsp/server.ts`).
  - `lease verify` inválido sale 2 (fail-closed, como `doctor`); `leaseCliTarget` devuelve `{ output, exitCode }`. Verificado en la 89: `lease verify --lease <inexistente> --project-root .` rc 2; compile, lint 0, check:core OK, `test:unit` 924 passing.
- [x] **T2 Reglas y rutas fijas de Kamples (alto).**
  - [x] `apiEndpointAnalyzer.ts`: rutas configurables con `apiRutas` en `sentinel.config.json` (validado en `config.ts`; sin clave = defaults de Kamples, iguales a antes) y regla condicionada con `reglaHabilitada`. Cobertura: `src/test/suite/runtime-proyecto/apiRutas.test.ts`. Autogate 0 en la 89.
  - [x] `css-adhoc-button-style`, `sqlx-query-as-sin-macro`, `sqlx-query-sin-macro` y `api-endpoint-faltante` registradas en `ruleRegistry.ts` y en `rules.md` (commit 5899d75); `api-endpoint-faltante` respeta `reglaHabilitada` (activa por defecto, como antes). Cobertura: `src/test/suite/diagnostico/registroReglasCompleto.test.ts`.
  - [x] `reactUiCatalog.ts` (`carpetasUi`) y `apiContractIndexer.ts` (`controladores`): rutas de design system y controllers configurables con `rutasGlory` en `sentinel.config.json` (validado en `config.ts`; sin clave = defaults idénticos). Cobertura: `src/test/suite/runtime-proyecto/rutasGlory.test.ts`. Verificado en la 89: compile rc 0, `test:unit` 939 passing / 0 failing, `check:reglas` y autogate 0 archivos con hallazgos.
- [ ] **T3 Documentación que no coincide con el código (medio).**
  - Scripts citados que no existen en `package.json`: `gate:check` (README:105,156,166; docs/operations.md:10-19; docs/concepts.md:11), `quality:lock` (docs/configuration.md:49), `quality:reports:cleanup:dry` (docs/operations.md:43). Acción: quitar las menciones que son de workspace-manager y declarar o quitar el resto.
  - `integrate --ff-only` (README:198, docs/operations.md:31) no es flag del CLI; el merge es interno (`src/core/task/coordinador/taskCoordinatorLifecycle.ts:203,210`). Acción: corregir el texto.
  - Instalación: `npm run cli` y `node out/cli/index.js` aparecen fuera del camino único; marcarlos como desarrollo. Reabre parcialmente S5.
  - `\n` literal en ayuda y error de `task`: `src/cli/parseo/argsUsage.ts:16`, `argsTask.ts:79`.
  - Códigos de salida sin documentar: 2 solo en `src/cli/index.ts:15-20`; `analyze` sale 1 con errores (`cliMain.ts:178`); `--help` de subcomando sale 2 (`argsParse.ts:233`).
  - README:44 «más de 100 reglas» frente a 121 en `rules.md:6`; `docs/pruebas.md:7` omite `check:reglas`; `.gitignore` no cubre `sentinel-autogate.json` ni `.sentinel-report.md`.
- [ ] **T4 Agnosticismo del core (medio).**
  - `src/utils/logger.ts:10,26` carga `vscode` en runtime y lo usa `src/core/gate/heavyBudget.ts:12`. `scripts/check-core-no-vscode.mjs:21` solo detecta `require` literal. Acción: mover el logger a adapter o inyectarlo, y ampliar el check.
  - `src/analyzers/static/portableRules.ts:27-28`: defaults `'/platform/'` y `'/adapters/'` fijos. Acción: configurables (igual que `marcadoresGlory`).
- [ ] **T5 Arquitectura, repo y optimización (medio).**
  - `git ls-files` sin timeout: `src/cli/comandos/cliAnalyze.ts:42-46`, `src/core/runtime-proyecto/envManifest.ts:147,173`, `src/core/task/coordinador/taskCoordinatorRutas.ts:15`. Acción: timeout y maxBuffer acotado.
  - Unos 19 recorridos de directorio propios (p. ej. `cliAnalyze.ts:96-118`, `install/artefacto.ts:25-33`, `utils/analisis/indiceProyecto.ts:13-27`). Acción: un solo recorredor con reglas de exclusión.
  - `cliAnalyze.ts:187-192,123`: análisis en serie y sin tope por archivo; `:210-221` salida JSON sin límite de entradas.
  - `src/lsp/server.ts:159-161`: sin debounce (la extensión sí lo tiene); relee la config y analiza de forma síncrona en `:91`.
  - Presupuestos: `scripts/module-budgets.json` fija 550–950 en barriles de 8–26 líneas; `staticCodeRules.ts` (704) se partirá; `apiContractIndexer.ts` (485) y `externalToolsAnalyzer.ts` (454) sin presupuesto.
  - `roadmap.md` sigue versionado: aplicar la misma decisión que en VarSense (sacarlo del repo).
  - `media/*.jpg` de 290 KB como icono (bajo); `src/core/guard/guardCommand.ts:77` con `readFileSync` en la ruta del guard (bajo).
- [ ] **T6 Autogate y tests (medio).**
  - `scripts/autogate.mjs:27` falla con cualquier hallazgo, sin umbral, y pasa si falta el campo (fail-open). `sentinel-autogate.json` lo referencia `package.json:135` pero no existe. Acción: archivo versionado, umbral explícito y fail-closed.
  - `sentinel.config.json:38` excluye solo `fixtures/equivalence`. Aplicar la misma exclusión de código de prueba que VarSense (decisión de la usuaria).
  - Timeout de 600000 ms en `scripts/autogate.mjs:18` (bajo).
- Cierre del backlog: autogate 0 hallazgos en la 89, `check:reglas`, `check:core`, `test:unit`, compile y lint en verde, y una instalación de tercero siguiendo solo el README.


## Bloqueos
- Verificación en la 89: clon de `HEAD` en `/var/tmp/glory-sentinel-verify` (no toca `~/taller`).
- Publicar o hacer release a terceros: reservado a la usuaria (AGENTS §3 del protocolo de `area-trabajo`).

## Hecho
- R1 Hallazgos de la revisión de terceros (2026-10-19, 0fa063b + 43bda9a, verificado en la 89): `bin/sentinel` sale ejecutable al instalar (fs.chmod, test no Windows); README con requisitos, destino, PATH, doctor, desinstalación y reglas de stages; skill sentinel corregida; roadmap sin AGENTS inexistente ni tmpDir mal ubicado; autogate documentado. Verificación: ci, compile, lint 0 warnings, mocha 912 passing / 0 failing / 2 pending, check:core, check:reglas, autogate 0 hallazgos en 266 archivos, instalación en contenido con `bin/sentinel` 755 y `--version` 0.7.26.
- S15.7 `src/analyzers/react/` (2026-10-19, verificado en la 89): las nueve reglas React pasan a `src/analyzers/react/reglas/` (con `git mv`, sin cambio de lógica); `reactAnalyzer.ts` y `formularioConfigSystem.ts` quedan en la raíz del directorio (2 archivos). Imports relativos ajustados, rutas de tests y `module-budgets.json` actualizados. Verificación: compile, tsc, mocha 911/0/2, lint, check:core, check:reglas rc 0; `--version` 0.7.26; `--help` rc 0; autogate 0 errores y 0 warnings (antes 1). **S15 cerrado: autogate a 0 warnings y 0 errores.**
- S15.6 `staticAnalyzer` (2026-10-19, verificado en la 89): `staticAnalyzer.ts` pasa a barril (9 líneas) con los mismos exports públicos (`analizarEstatico`, `StaticAnalysisOptions`, `limpiarDirectoriosReportados`, `tieneSentinelDisableFile`). La lógica va a `src/analyzers/static/analisis/`: `staticOrquestador` (196), `staticSentinelDisable` (29), `staticLineas` (130), `staticReglasPorLinea` (136) y `staticReglaCompleta` (55). Sin cambio de comportamiento. Verificación: compile, tsc, mocha 911/0/2, lint, check:core, check:reglas rc 0; `--version` 0.7.26; `--help` rc 0; autogate 0 errores y 1 warning (antes 2).
- S15.5 `rustAnalyzer` (2026-10-19, verificado en la 89): `rustAnalyzer.ts` pasa a barril (17 líneas) con el mismo export `analizarRust`. La lógica va a `src/analyzers/rust/analisis/`: `rustOrquestador` (81 líneas), `rustPanicUnwrap` (104), `rustPatronesLinea` (134), `rustFunciones` (196) y `rustAxumRutas` (93). Sin cambio de comportamiento. Verificación: compile, tsc, mocha 911/0/2, lint, check:core, check:reglas rc 0; `--version` 0.7.26; `--help` rc 0; autogate 0 errores y 2 warnings (antes 3). El budget de `rustAnalyzer.ts` (650) se mantiene como en S14 para barriles.
- S15.4 `runtimeInstall` (2026-10-19, verificado en la 89): `runtimeInstall.ts` pasa a barril (17 líneas) con los mismos 17 exports públicos; la lógica va a `src/core/runtime-proyecto/install/` (`tipos`, `rutas`, `artefacto`, `version`, `puntero`, `instalar`, `rollback`, `desinstalar`, `estado`; 9 módulos, cada uno ≤ 121 líneas). `resolveSourceRoot` gana un nivel en `__dirname`. Verificación: compile, tsc, mocha 911/0/2, lint, check:core, check:reglas rc 0; `--version` 0.7.26; `--help` rc 0; autogate 0 errores y 3 warnings (antes 4).
- S15.3 `projectInit` (2026-10-19, verificado en la 89): `projectInit.ts` pasa a barril (20 líneas) con los mismos exports; la lógica va a `src/core/runtime-proyecto/init/` (`presets` 109, `plan` 149, `migrar` 80, `formato` 39 líneas). El directorio `runtime-proyecto/` sigue con 10 archivos `.ts` (la lógica vive en una subcarpeta). `buildPolicyConfig`, `buildLockConfig` y `readJson` se exportan solo entre módulos de `init/`, no desde el barril. Verificación: compile, tsc, mocha 911/0/2, lint, check:core, check:reglas rc 0; `--help` rc 0; autogate 0 errores y 4 warnings (antes 5).
- S15.2 `analisisHelpers` (2026-10-19, verificado en la 89): `src/utils/analisisHelpers.ts` pasa a barril (6 líneas); la lógica va a `src/utils/analisis/` (8 módulos, cada uno bajo 130 líneas). Constantes de `indiceEnlaces` como `ReadonlySet` (`conjuntoConstante`) y caché de índice en `indiceProyecto.ts`, no exportada. Verificación: compile, tsc, mocha 911/0/2, lint, check:core, check:reglas, `--help` rc 0; autogate 0 errores y 5 warnings (antes 8).
- S14 Partición CLI y núcleo (2026-10-19, ffd171e + 5324b01, verificado en la 89): `src/cli/parseo/` y `src/cli/comandos/` con `cliMain.ts`; `args.ts` y `commands.ts` pasan a barril. `diagnose.ts` y `lease.ts` son fachadas sobre `detalle/`. Verificación: compile, tsc, mocha 911/0/2, lint, check:core, check:reglas, smoke `--version`/`--help`, autogate 0 errores y 8 warnings (antes 10; `directorio-abarrotado` de diagnostico y gate resuelto).
- S6 Arquitectura (2026-10-19, verificado): core no importa analyzers; `check:core` lo impide (regla S6 de `scripts/check-core-no-vscode.mjs`) y la composición vive en `src/analyzers/pipeline.ts`. Sin cambios de código en este bloque.
- S7 Optimización (2026-10-19, verificado): `scope.ts` usa `GIT_SALIDA_MAX_BYTES = 8 MiB` (antes 64 MB); `externalToolsAnalyzer.ts` acota salida a 5 MiB y timeout a 120 s. Sin cambios de código en este bloque.
- S8 Docs de dominio (2026-10-19, verificado): README sin narrativa interna (039A-1); enlaza a `docs/pruebas.md`. Sin cambios de código en este bloque.
- S13 Directorio-abarrotado en tests (2026-10-19): 72 archivos `*.test.ts` de `src/test/suite` agrupados por dominio; 911 pasan, 0 fallan en la 89. Autogate: 0 hallazgos en tests; 13 warnings heredados (límites de líneas, mixed-barrel) en la cola de arriba.
- S10 Temporales agnósticos (2026-10-19, e2e2f5a): `src/core/seguridad-rutas/tmpDir.ts` (`tmpBaseDir`; `SENTINEL_TMP_DIR` sustituye C:/tmp). Guard log, scheduler y tests lo usan.
- S11 Shells (2026-10-19, 80f3621): causa real = en bash `glory_sentinel_host_path` convertía `/var/tmp/x` a `\var\tmp\x`; el CLI no hallaba la política y el guard dejaba pasar (fail-open). Corregido: solo las rutas con unidad se convierten. `shellMatrix` 12 pasan en la 89, sin tests condicionados.
- S12 Lint (2026-10-19, d7a708f): 0 errores y 0 warnings en la 89. `check:core` requirió no crecer `interceptorShims.ts` (presupuesto 783).
- S2 Versión única (2026-10-19): `package.json`, `package-lock.json`, README y CHANGELOG coinciden en 0.7.26; tag anotado `v0.7.26` empujado a origin. La ayuda no lleva versión fija.
- S5 Instalación en una vía (2026-10-19): el README documenta un único camino (`git checkout v0.7.26` → `npm ci` → `npm run compile` → `install`).
- S3 Catálogo generado (2026-10-19): `scripts/catalogo-reglas.mjs` escribe `rules.md` desde el registro (121 reglas, antes 106) y `check:reglas` entra en `test:unit`. Verificado en la 89.
- S4 Ayuda única (2026-10-19): `help.txt` retirado; `sentinel --help` sale de `src/cli/args.ts`.
- Engines: `node >=20` declarado (inferido de @types/node 20; probado en Node 24.21).
- S1 Higiene del repo (2026-10-19): `test-indexer.mjs`, `test_cli.js` fuera; planes a `Agente/planes/`. Verificado en la 89: compile, check:core, smoke:lsp OK; `test:unit` 908 pasan, 3 fallan (S10, S11; preexistentes, no del bloque).
