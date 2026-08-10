# Conceptos de Sentinel

## Sentinel

Sentinel es el producto y plano de control de calidad. Puede ejecutar analizadores, plugins y stages del
stack, pero conserva una única decisión de cierre y un único contrato de reporte.

## Gate

El gate es la operación `sentinel check <task-id>`. En un consumidor puede existir un wrapper fino como
`gate:check` para generar el manifest específico del stack; ese wrapper no decide PASS/FAIL ni implementa
scope, cache, scheduler, budgets o reporter.

`task:check` es una compatibilidad temporal de consumidores legacy. No debe recibir nuevas capacidades ni
convertirse en un segundo gate.

## Analyzer y plugin

Un analyzer detecta findings estáticos con un contrato estable. Un plugin es un analyzer o extensión
publicada, versionada y fijada por commit/hash/capabilities. VarSense es un analyzer especializado; no es un
gate paralelo ni decide el cierre.

## Adapter del consumidor

El adapter solo encapsula comandos, manifests y reglas reales del stack o del dominio. No debe implementar
scope universal, cache compartida, locks, coordinación, reporter final ni reglas que ya pertenezcan al Core.

## Task y coordinación

`sentinel task` coordina claims, worktrees, heartbeat, gate, integración, cleanup y release cuando el
consumidor declara esa capability. Es coordinación local por workspace/clon; clones distintos no comparten
ownership.

## Regla de ownership

Cada regla o capability tiene un único dueño productivo: Core, plugin, configuración o adapter project-owned.
Las copias legacy se mantienen solo durante una migración con paridad, rollback y sunset.
