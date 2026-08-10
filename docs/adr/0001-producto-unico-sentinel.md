# ADR 0001 — Sentinel como producto único: `sentinel check` es el gate

> **Estado:** aceptado (Fase 2 de la auditoría, 2026-08-10)
> **Aplica a:** release upstream `glory-sentinel` (rama de trabajo `f1/cli-contracts`)
> **Tarea:** `108A-1` — auditoría completa de Glory Sentinel y el quality gate (§14, Fase 2)

## Contexto

Sentinel creció como una extensión de editor con un CLI adjunto y lógica de
gate dispersa entre el core, el CLI y los consumidores (`scripts/quality`).
Antes de mover más comportamiento desde el consumidor hay que delimitar el
producto: qué es Sentinel, cuáles son sus módulos internos y qué contratos
deben cumplir las extensiones para que añadir una no rompa el núcleo
(SRP/OCP/LSP/ISP/DIP).

## Decisión

1. **Sentinel es un producto único.** El **gate es `sentinel check`**
   (dueño de scope, cache, stages, budgets y reporte). El resto de comandos
   (`analyze`, `doctor`, `status`, `install`, `lease`, `task`) son
   capacidades del mismo producto, no productos separados.
2. **Un solo CLI**, con parsing y dispatch separados:
   `src/cli/args.ts` (argumentos/usage), `src/cli/commands.ts` (handlers y
   dispatch por comando) y `src/cli/index.ts` (barril + entry point). El
   contrato público del módulo `cli` no cambia.
3. **Módulos internos** (mapa de responsabilidad; los archivos actuales se
   consolidan en Fase 5/6, el ADR fija la frontera desde ya):

   | Módulo | Responsabilidad | Archivos actuales |
   | --- | --- | --- |
   | `analysis` | Analizadores agnósticos y reglas | `src/analyzers/`, `core/analyzeDocument.ts`, `core/report.ts`, `core/violacionAdapter.ts`, `core/language.ts` |
   | `gate` | Alcance, scheduler, cache, etapas, reporte, lease, preflight | `core/gateRun.ts`, `core/scope.ts`, `core/scheduler.ts`, `core/stageRunner.ts`, `core/stageCache.ts`, `core/stageManifest.ts`, `core/gateReport.ts`, `core/structuredTool.ts`, `core/toolRunner.ts`, `core/guardCommand.ts`, `core/lease.ts`, `core/pathContainment.ts`, `core/diagnose.ts` |
   | `runtime` | Instalación global, shims | `core/runtimeInstall.ts`, `core/interceptorShims.ts` |
   | `task` | Orquestación de tareas (opcional) | `core/taskCoordinator.ts`, `core/taskRecovery.ts`, `core/branchValidation.ts` |
   | `editor` | Integración VS Code/LSP | `src/extension.ts`, `src/lsp/`, `src/platform/`, `src/providers/`, `src/services/`, `src/handlers/`, `core/vscodeAdapter.ts`, `analyzers/externalToolsAnalyzer.ts` |
   | `cli` | Comandos del producto | `src/cli/` |
   | transversal | Config, tipos, utils | `src/config/`, `src/types/`, `src/utils/`, `src/errors/` |

4. **DIP:** el núcleo y el CLI dependen de puertos estructurados
   (filesystem, proceso, reporter, lease), nunca de `scripts/quality` del
   consumidor ni de los módulos del editor. `check:core` lo hace cumplir.
5. **`check` es independiente de shims, perfiles y worktrees**: no importa
   `interceptorShims` ni `taskCoordinator`. `task` y los shims son
   **capabilities opcionales** del doctor (requeridas: `analyze`, `check`,
   `doctor`, `status`).
6. **Una regla, un dueño.** `src/config/ruleRegistry.ts` es la única fuente
   de las reglas del núcleo; `src/core/extensionRegistry.ts` valida las
   extensiones: identidad, owner, rule IDs, entrypoint, fixtures, budgets y
   condición de retirada. Se rechazan colisiones de rule IDs (entre
   extensiones o contra el núcleo) y extensiones ejecutables no declaradas.
7. **OCP:** añadir un analyzer/regla no modifica el scheduler/reporting core;
   los plugins devuelven el contrato `ToolOutcome` de `structuredTool.ts`
   (LSP) y solo reciben lo que usan (ISP).
8. **Budget de tamaño por módulo** en `scripts/module-budgets.json`,
   verificado por `check:core`. Los módulos de consolidación
   (`taskCoordinator`, `interceptorShims`, `runtimeInstall`, `diagnose`) y
   los plugins de stack grandes (`reactComponentRules`, `rustAnalyzer`,
   `staticCssRules`, `apiContractIndexer`, `phpDataRules`) tienen presupuesto
   con excepción justificada: se dividen en Fase 5/6; el budget frena el
   crecimiento mientras tanto. Los módulos no listados quedan sin budget
   hasta estabilizarse (el script reporta el top-10).

## Consecuencias

- Las extensiones locales/publicadas deben registrarse antes de producir
  findings; el doctor/gate rechaza colisiones y ejecutables no declarados.
- El editor queda delimitado: solo `vscodeAdapter.ts` y
  `externalToolsAnalyzer.ts` (excepción documentada) tocan la API de VS Code
  en el árbol actual; se portan al módulo `editor` en la consolidación.
- No se elimina legacy en esta fase: la extracción se entrega en commits
  pequeños sin cambiar el contrato público, y los adapters de compatibilidad
  se conservan hasta que cada módulo nuevo tenga paridad.

## Rollback

- Revertir el commit de esta fase devuelve el árbol a `44dc8fa` + Fase 1 sin
  migración (no hay cambios de schema ni de exit codes).
- Los fixtures/snapshots antes y después conservan decisiones y findings
  ordenados (gate de refactor de la auditoría).

## Referencias

- Auditoría §14 Fase 2 (checklist de arquitectura, validación SOLID, gate de
  refactor, rollback).
- `scripts/check-core-no-vscode.mjs` (fronteras + budgets).
- `src/core/extensionRegistry.ts` y `src/test/suite/extensionRegistry.test.ts`.
