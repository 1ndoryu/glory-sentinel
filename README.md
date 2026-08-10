# Glory Sentinel

Sentinel es el producto de calidad del ecosistema Glory: analiza código, ejecuta plugins y stages del stack,
genera el reporte y toma la única decisión de cierre.

La detección es estática y determinista. No requiere IA, red, claves ni servicios externos.

## La idea en 30 segundos

- **Sentinel**: el producto y el CLI.
- **Gate**: la operación `sentinel check <task-id>`.
- **`gate:check`**: wrapper fino del consumidor que prepara el manifest y delega en `sentinel check`.
- **VarSense**: analyzer especializado; informa hallazgos, pero no decide el cierre.
- **`task`**: coordinación local opcional de claims, worktrees, integración y cleanup.

Debe existir una sola decisión de cierre. `task:check` solo queda como compatibilidad temporal en consumidores
legacy; no se debe ampliar ni convertir en un segundo gate.

## Proyecto nuevo

Usa un release que muestre estas capabilities en `sentinel --help` (0.7.0 o posterior):

```bash
sentinel init --preset <node|rust|python|mixed> \
  --project-root . --primary-branch <rama-real>
sentinel doctor --json --workspace .
sentinel check BOOTSTRAP-01 --stages <manifest-generado>
```

`init` es idempotente y `--dry-run` no modifica nada. No copia `scripts/quality`, configs ni reglas de otro
proyecto. La rama primaria pertenece al consumidor; nunca se supone que sea `main`.

En un consumidor con wrapper npm:

```bash
npm run gate:check -- BOOTSTRAP-01
```

## Proyecto existente

Primero comprueba la capacidad real del binario:

```bash
sentinel --help
sentinel doctor --json --workspace .
```

Si el help ofrece `migrate`, ejecuta:

```bash
sentinel migrate --project-root . --json
```

La migración solo inventaría; no borra ni desactiva cobertura. Clasifica cada regla o script como Core,
plugin, configuración, adapter específico, fixture, duplicado u origen desconocido. Lo desconocido bloquea
la retirada. Nunca copies una carpeta personal de un agente ni `scripts/quality` de otro proyecto.

## Comandos habituales

```bash
# Analizar cualquier carpeta
sentinel analyze --workspace . --format json

# Calcular alcance sin ejecutar etapas
sentinel check <task-id> --dry-run

# Ejecutar un gate con stages declarativos
sentinel check <task-id> --stages <manifest.json>

# Diagnosticar instalación, lock y capabilities
sentinel doctor --json

# Ver tareas y recursos de coordinación
sentinel task status --project-root . --json
```

Los reportes combinados viven en `.quality-reports/`. Un timeout, error de herramienta, cancelación o test
fallido nunca se clasifica como PASS.

## Compatibilidad

La versión semántica no garantiza capabilities. Siempre compara `--help`, commit, protocolo y lock.

| Release | Aporta |
| --- | --- |
| 0.4.x | analyzer `analyze`, configuración v1 y salida JSON |
| 0.5.x | plano global: `check`, `guard`, `doctor`, `status`, leases y `task` |
| 0.6.x | preflight fail-closed, validación de release y recuperación segura |
| 0.7.x | `init`, `migrate`, `uninit`, readiness separada, registro de extensiones y stages declarativos |

El release coordinado vigente es **0.7.0**, publicado en `main` y `v0.7.0`.

## Configuración mínima

- `sentinel.config.json`: política, gate, guard, analyzer y `project.primaryBranch`.
- `sentinel.lock.json`: versión, commit, protocolo, capabilities y hashes instalados.

Durante la migración pueden existir `quality.config.json`, `quality-tools.json`, `varsense.config.json` y
`quality-adapter.json`. Son superficies legacy y no se copian a proyectos nuevos.

Una extensión local solo se conserva si es project-owned, tiene un único owner, fixtures, límites de recursos,
presupuesto, justificación de dominio y condición de retirada. Una regla o capability no puede tener dos
dueños productivos.

## Documentación detallada

- [Conceptos](docs/concepts.md)
- [Configuración](docs/configuration.md)
- [Operación](docs/operations.md)
- [Migración desde un gate legacy](docs/migration.md)
- [ADR: producto único](docs/adr/0001-producto-unico-sentinel.md)
- [Contrato de stages](docs/stage-manifest-contract.md)
- [Catálogo de reglas](rules.md)

## Desarrollo de Sentinel

```bash
npm install
npm run compile
npm run test:unit
node out/cli/index.js --help
```

El CLI compilado está en `out/cli/index.js`; el LSP en `out/lsp/server.js`. El checkout debe estar limpio
antes de publicar o fijar un commit en un consumidor.
