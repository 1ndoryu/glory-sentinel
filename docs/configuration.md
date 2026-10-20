# Configuración de Sentinel

## Contrato mínimo

Un consumidor coordinado declara una política y un lock verificable:

- `sentinel.config.json`: modo, rama primaria, gate, guard y configuración del analyzer.
- `sentinel.lock.json`: versión, commit, protocolo, capabilities y hashes realmente instalados.

El `project.primaryBranch` pertenece al consumidor. Nunca se infiere `main`.

Durante la transición, pueden existir `quality.config.json`, `quality-tools.json`, `varsense.config.json`
y `quality-adapter.json`. Son superficies legacy: se conservan mientras el adapter las necesite y no se
copian a proyectos nuevos.

## Claves de análisis

Dentro del analizador (`analyzers.sentinel.config` o la raíz v1):

- `includePatterns`: los defaults completan las extensiones que la ficha omite, dentro de los ámbitos
  que la ficha declara. Una familia sin ningún patrón declarado queda fuera del alcance.
- `excludePatterns`: sustituye los defaults de exclusión; es la vía para quitar algo que los defaults incluyen.
- `directoryExceptions`: patrones glob de directorios que la regla de directorio abarrotado no revisa.
- `apiRutas`: contrato de rutas del endpoint analyzer. `mapa` y `prefijosMapa` (string → string) reescriben rutas legacy; `mantener` y `prefijosMantener` dejan intactas las que listan. Claves desconocidas dan error. Sin la clave, se usan los valores por defecto del analizador.
- `marcadoresGlory`, `rutasGlory`: marcadores y carpetas del perfil Glory (ver «Reglas y perfiles»).

Nivel raíz de la política v2:

- `mode`: `enforce`, `observe` o `pass-through`. Otro valor da error.
- `runtime`: `minimumVersion`, `protocolVersion` y `lockFile`. Se valida su forma; el análisis no lo usa.
- `budgets`: `mode` (`observe` o `enforce`) y `limits` (objeto de número por tipo). Lo lee el tope físico, no el analizador.

## Reglas y perfiles

Cada regla se ajusta con `habilitada` (boolean) y `severidad`. Los ids y su categoría están en
[rules.md](../rules.md). La ruta depende de `schemaVersion`:

- v2: `analyzers.sentinel.config.rules`.
- v1: `rules` en la raíz.

```json
{
  "schemaVersion": 2,
  "analyzers": { "sentinel": { "config": { "rules": { "wpdb-sin-prepare": { "habilitada": true } } } } }
}
```

Las reglas que tratan `/Glory/` y `/glory-core/` como código del framework (exentas de las reglas de proyecto)
usan esos marcadores por defecto. Un proyecto con otro nombre de framework los declara en
`marcadoresGlory` (lista de fragmentos de ruta, junto a `rules`); una lista vacía vuelve al defecto.

Las exenciones son opt-in: sin la clave, el análisis no omite ninguna ruta ni componente. Para el framework Glory:

```json
{ "exenciones": { "perfil": "glory" } }
```

El perfil `glory` exime las rutas `/glory-rs/` y `/public/assets/` de las reglas CSS de estilo ad-hoc, y los
componentes `PageRenderer`, `ModalAcciones`, `GloryLink` y `Range` de la regla de HTML nativo. `rutas` y
`componentes` añaden más fragmentos propios; las claves desconocidas dentro de `exenciones` se rechazan.

Las reglas de WordPress y de Glory vienen desactivadas por defecto, porque en un proyecto ajeno dan falsos
positivos. Si Sentinel detecta el perfil (carpeta `Glory`, `wp-content`, `wp-config.php` o un tema con
`Theme Name:`), el informe del gate lo indica y sugiere la ruta exacta para activarlas. Nunca las activa solo.

El analizador Glory (índices de schema, constantes, contratos API e islas, y las reglas `GlorySchema` como
`api-endpoint-faltante`) solo se activa si el proyecto tiene carpeta `Glory` (profundidad máxima 3) o declara
`rutasGlory`. En cualquier otro proyecto no indexa nada ni aplica esas reglas; las genéricas sí siguen activas.

Las reglas portables de arquitectura usan fronteras por fragmento de ruta en `portableBoundaries`:
`dom`, `window`, `services` y `loggerModules`. Si una clave se declara, sustituye su valor por defecto
(`src/analyzers/static/portableRules.ts`, p. ej. `/platform/` y `/adapters/` en `dom`); una lista vacía
desactiva esa frontera. `tooling` se suma a las carpetas de herramientas de serie (`/test/`, `/scripts/`…).

## Tools y capabilities

`quality-tools.json` fija repository, `sourcePath`, commit, versión, CLI, scripts de build/test y
capabilities. `sentinel.lock.json` debe coincidir con gitlink, checkout, versión y hash; no se edita a mano.

Antes de usar una orden avanzada:

```bash
sentinel --help
sentinel doctor --json --workspace .
```

La versión semántica no prueba capabilities. Si `--help` no muestra `init`, `migrate`, `check` o `task`, la
instalación no ofrece ese plano y debe actualizarse desde un release publicado.

## Extensiones

Una extensión project-owned debe declarar owner, propósito, entrypoint, rule IDs/capabilities, scope,
severidad, fixtures, timeout, memoria, presupuesto y condición de retirada. `doctor`/CI deben rechazar
extensiones ejecutables no declaradas y IDs con doble owner.
