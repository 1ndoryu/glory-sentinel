# Plan: hallazgos de la revisión y prueba de instalación (2026-10-19)

Origen: prueba de instalación como tercero (FALLA) y revisión de diez puntos. Este plan es la lista viva: cada casilla se marca al cerrarse. Los cambios que tocan tags, releases o historia están reservados a la usuaria y se anotan sin ejecutar.

## Corregir ahora

- [ ] **Permiso de ejecución.** `bin/sentinel` llega sin bit de ejecución al instalar en modo contenido (`Permission denied`, rc 126). Causa: `writeCliShims` (`src/core/runtime-proyecto/install/puntero.ts`) escribe el shim con `writeAtomic`, que no fija el modo. No es un problema de git: `bin/` no está versionado (se genera al instalar). Corrección: `fs.chmod` 0o755 sobre `bin/sentinel` y `current.js`, con test en `runtimeInstall.test.ts` (no Windows). Comprobar en la 89 con un clon limpio.
- [x] **README: requisitos.** `README.md:117-120` y alrededor: Node 20 (`engines` y `.github/workflows/ci.yml:16`), git, shell requerido en Windows.
- [x] **README: destino y PATH.** Documentar el destino por defecto (`src/core/runtime-proyecto/install/rutas.ts:6-8`) y que `--with-path` modifica el PATH de usuario (`src/cli/cliMain.ts:102-103`). En Linux `--with-path` sale `[path] UNSUPPORTED` (dry-run): documentarlo.
- [x] **README: doctor.** `README.md:129-131`: explicar que `doctor` pide `sentinel.lock.json` (`lock-missing`) y si el propio repo debe pasar doctor.
- [x] **README: desinstalación y stages.** (Stages: reglas del manifest y enlace al contrato; el ejemplo sigue siendo el mínimo, el repo no tiene manifest propio.) Añadir `sentinel uninstall` (`src/cli/parseo/argsUsage.ts:33`) y un ejemplo real de `sentinel-stages.json` (hoy solo el de `README.md:80-95`).
- [x] **Skill sentinel.** `C:\Users\Owner\.agents\skills\sentinel\SKILL.md` (paso 3): `task:check` declarado como gate canónico contra `quality-gate-setup/SKILL.md:38` y `README.md:108`; corregir. Cita `latest-report.md`; el código escribe `latest.json` y `latest.md` (`src/core/gate/gateReport.ts:237-238`).
- [x] **Roadmap desfasado.** `roadmap.md:13,17` cita un `AGENTS.md` inexistente; `roadmap.md:30` dice 73 tests frente a 72 `*.test.ts`; `roadmap.md:31` ubica `tmpDir.ts` en `src/core/tmpDir.ts` (real: `src/core/seguridad-rutas/tmpDir.ts`).
- [x] **Autogate documentado.** Ningún README ni doc describe cómo Sentinel se gatea a sí mismo; `ci.yml` no ejecuta `check:reglas` ni `sentinel analyze`. Documentar el comando (sin inventarlo: tomarlo de `roadmap.md` y de los scripts reales).

## Anotado para después (no se toca en este bloque)

- [ ] **Versión del README (reservado).** `README.md:117-120` fija `v0.7.23`, el HEAD está en 0.7.26. Crear o no el tag y releases es decisión de la usuaria. Pendiente: alinear el README con la versión que se publique.
- [ ] **Agnosticismo.** Reglas WordPress (`src/config/ruleRegistry.ts:62-87`) y Glory (`:91-96`, `:128-150`) activas por defecto (`:305`); rutas `'/Glory/'` fijas en `src/analyzers/gloryAnalyzer.ts:102,110,137` y `src/analyzers/static/analisis/staticOrquestador.ts:93`; nombres de proyecto en comentarios del núcleo (`src/core/runtime-proyecto/config.ts:236-241`). Mover a configuración; requiere decisión de la usuaria sobre el comportamiento por defecto.
- [ ] **SOLID.** `src/analyzers/static/staticCodeRules.ts` 494 líneas sin budget en `scripts/module-budgets.json`. Dividir o registrar el budget.
- [ ] **Repo limpio.** `integrations/zed/extension.wasm` versionado (binario); `Agente/` versionado; `.gitignore:7` con ruta de Zed de origen incierto (verificar). Decidir qué sale del repo.
- [ ] **Optimización.** Sin perfilado; hay cachés de índice y de etapas. Medir antes de tocar.
- [ ] **Historia.** Reescritura de commits `9b42adf` y `eb4819e`: reservado a la usuaria; no se hace.

## Decidido por la usuaria (pendiente)

- Ninguno todavía.
