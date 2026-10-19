# Configuración de Sentinel

## Contrato mínimo

Un consumidor coordinado declara una política y un lock verificable:

- `sentinel.config.json`: modo, rama primaria, gate, guard y configuración del analyzer.
- `sentinel.lock.json`: versión, commit, protocolo, capabilities y hashes realmente instalados.

El `project.primaryBranch` pertenece al consumidor. Nunca se infiere `main`.

Durante la transición, pueden existir `quality.config.json`, `quality-tools.json`, `varsense.config.json`
y `quality-adapter.json`. Son superficies legacy: se conservan mientras el adapter las necesite y no se
copian a proyectos nuevos.

## Reglas y perfiles

Cada regla se ajusta con `habilitada` (boolean) y `severidad`. Los ids y su categoría están en
[rules.md](rules.md). La ruta depende de `schemaVersion`:

- v2: `analyzers.sentinel.config.rules`.
- v1: `rules` en la raíz.

```json
{
  "schemaVersion": 2,
  "analyzers": { "sentinel": { "config": { "rules": { "wpdb-sin-prepare": { "habilitada": true } } } } }
}
```

Las reglas de WordPress y de Glory vienen desactivadas por defecto, porque en un proyecto ajeno dan falsos
positivos. Si Sentinel detecta el perfil (carpeta `Glory`, `wp-content`, `wp-config.php` o un tema con
`Theme Name:`), el informe del gate lo indica y sugiere la ruta exacta para activarlas. Nunca las activa solo.

## Tools y capabilities

`quality-tools.json` fija repository, `sourcePath`, commit, versión, CLI, scripts de build/test y
capabilities. `sentinel.lock.json` debe coincidir con gitlink, checkout, versión y hash; no se edita a mano.

Antes de usar una orden avanzada:

```bash
sentinel --help
sentinel doctor --json --workspace .
npm run quality:lock -- --check
```

La versión semántica no prueba capabilities. Si `--help` no muestra `init`, `migrate`, `check` o `task`, la
instalación no ofrece ese plano y debe actualizarse desde un release publicado.

## Extensiones

Una extensión project-owned debe declarar owner, propósito, entrypoint, rule IDs/capabilities, scope,
severidad, fixtures, timeout, memoria, presupuesto y condición de retirada. `doctor`/CI deben rechazar
extensiones ejecutables no declaradas y IDs con doble owner.
