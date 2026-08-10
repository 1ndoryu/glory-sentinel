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

`gate:check` genera el manifest y delega en `sentinel check`. Los reportes combinados Markdown/JSON viven
en `.quality-reports/`. Diferenciar findings, FAIL, error de herramienta, timeout, cancelación y cobertura
no ejecutada; un error de herramienta nunca es PASS.

## Coordinación

Cuando la capability está disponible:

```text
claim → start → heartbeat/gate → commit → integrate --ff-only → cleanup → release
```

El worktree debe quedar dentro de la raíz autorizada y cleanup no borra recursos ajenos.

## Diagnóstico, rollback y limpieza

```bash
sentinel doctor --json
sentinel status --json
sentinel task status --project-root . --json
sentinel rollback --target-root <runtime> --version <version> --dry-run
npm run quality:reports:cleanup:dry
```

Verificar lock, branch, procesos, leases, worktrees y ramas antes de retirar algo. Push, deploy y escrituras
externas quedan fuera de este runbook.
