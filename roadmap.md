# Roadmap — glory-sentinel

Meta activa: máxima calidad de Sentinel (arquitectura, repo limpio, instalación, CLI, docs, agnosticismo, coherencia, autogate).
Orden de ejecución: de arriba abajo. Cada bloque: probar en la 89, documentar, commitear, cerrar en `Agente/completados/`.

## Pendiente

- [ ] **S9 Autogate en Arranque.** El análisis se ejecuta bien en la 89 (`analyze`, ver S13), pero falta la ficha de Arranque / endpoint `POST /api/gate/analizar`. Bloqueo: cambio en workspace-manager (registro y backend), fuera de este repo.

- Gate de RESTAURANTE (10AA-3, 2026-10-19): Sentinel se ejecuta en la 89 desde `/var/tmp/gate-tools/sentinel` (archive de `b4d043b`, versión 0.7.26; el adaptador comprueba `.quality-pin` y `--version` antes de cada análisis), no desde `tools/sentinel` de los submódulos de la 89, que están sucios por otra sesión. Pendiente de quien lleva Sentinel: decidir si el submódulo de la 89 se fija a ese pin o el pin se declara de otra forma. No tocado desde RESTAURANTE.

## Decisiones pendientes de la usuaria
- Tags y release: crear `v0.7.26` (o declarar 0.7.23 vigente). Reservado a la usuaria (AGENTS §3).

## Bloqueos
- Verificación en la 89: clon de `HEAD` en `/var/tmp/glory-sentinel-verify` (no toca `~/taller`).
- Publicar o hacer release a terceros: reservado a la usuaria (AGENTS §3).

## Hecho
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
- S13 Directorio-abarrotado en tests (2026-10-19): 73 tests de `src/test/suite` agrupados por dominio; 911 pasan, 0 fallan en la 89. Autogate: 0 hallazgos en tests; 13 warnings heredados (límites de líneas, mixed-barrel) en la cola de arriba.
- S10 Temporales agnósticos (2026-10-19, e2e2f5a): `src/core/tmpDir.ts` (`tmpBaseDir`; `SENTINEL_TMP_DIR` sustituye C:/tmp). Guard log, scheduler y tests lo usan.
- S11 Shells (2026-10-19, 80f3621): causa real = en bash `glory_sentinel_host_path` convertía `/var/tmp/x` a `\var\tmp\x`; el CLI no hallaba la política y el guard dejaba pasar (fail-open). Corregido: solo las rutas con unidad se convierten. `shellMatrix` 12 pasan en la 89, sin tests condicionados.
- S12 Lint (2026-10-19, d7a708f): 0 errores y 0 warnings en la 89. `check:core` requirió no crecer `interceptorShims.ts` (presupuesto 783).
- S2 Versión única (2026-10-19): `package.json` 0.7.26 es la fuente; `README.md` declara 0.7.23 como último tag y 0.7.26 sin etiquetar; CHANGELOG `[Unreleased]` recoge 0.7.24–0.7.26. La ayuda no lleva versión fija.
- S5 Instalación en una vía (2026-10-19): el README documenta un único camino (`git checkout v0.7.23` → `npm ci` → `npm run compile` → `install`), sin tag nuevo.
- S3 Catálogo generado (2026-10-19): `scripts/catalogo-reglas.mjs` escribe `rules.md` desde el registro (121 reglas, antes 106) y `check:reglas` entra en `test:unit`. Verificado en la 89.
- S4 Ayuda única (2026-10-19): `help.txt` retirado; `sentinel --help` sale de `src/cli/args.ts`.
- Engines: `node >=20` declarado (inferido de @types/node 20; probado en Node 24.21).
- S1 Higiene del repo (2026-10-19): `test-indexer.mjs`, `test_cli.js` fuera; planes a `Agente/planes/`. Verificado en la 89: compile, check:core, smoke:lsp OK; `test:unit` 908 pasan, 3 fallan (S10, S11; preexistentes, no del bloque).
