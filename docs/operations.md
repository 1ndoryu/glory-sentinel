# Operación de Sentinel

## Proyecto nuevo

Con un release que exponga las capabilities requeridas:

```bash
sentinel init --preset <node|rust|python|mixed> --project-root . --primary-branch <rama-real>
sentinel doctor --json --workspace .
npm run gate:check -- BOOTSTRAP-01
```

`init --dry-run` no muta. `doctor` distingue `readyForAnalyze` de `readyForGate`.

## Gate y reportes

```bash
npm run gate:check -- <ID>
npm run gate:check -- <ID> --full
```

`gate:check` es el alias que creó `init --with-alias gate:check` y ejecuta `sentinel check`. Los reportes combinados Markdown/JSON viven
en `.quality-reports/`. Diferenciar findings, FAIL, error de herramienta, timeout, cancelación y cobertura
no ejecutada; un error de herramienta nunca es PASS.

## Coordinación

Cuando la capability está disponible:

```text
claim → start → heartbeat/gate → commit → integrate → cleanup → release
```

`integrate` fusiona con fast-forward interno (no es un flag del CLI).

## Códigos de salida

| Código | Significado |
| --- | --- |
| 0 | Correcto; `check` y `task gate` con PASS |
| 1 | `analyze` con hallazgos de severidad error; `check` con FAIL; `init` con conflictos en el plan (no aplica nada) |
| 2 | Error de uso o excepción; `check` con SETUP ERROR; `lease verify` no válido |
| 130 | `check` cancelado |

`task` devuelve 0 salvo `task gate`, que devuelve el código del gate.

El worktree debe quedar dentro de la raíz autorizada y cleanup no borra recursos ajenos.

## Diagnóstico, rollback y limpieza

```bash
sentinel doctor --json
sentinel status --json
sentinel task status --project-root . --json
sentinel rollback --target-root <runtime> --version <version> --dry-run
```

Verificar lock, branch, procesos, leases, worktrees y ramas antes de retirar algo. Push, deploy y escrituras
externas quedan fuera de este runbook.
