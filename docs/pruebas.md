# Pruebas y timeouts de Mocha

Guía para quien toca la suite de Sentinel. El README solo enlaza aquí.

## Perfiles de ejecución

- `npm run test:unit` es el perfil headless: `compile` + `check:core` + `smoke:lsp` + la suite de Mocha.
- `npm test` (runner de VS Code) no sirve para un staging aislado porque exige la app.
- La suite incluye tests de fixture reales (`git init`/`commit` y spawn del CLI, además de spawns de shell). Un caso aislado puede tardar entre 2 s y 25 s.
- El `timeout` de `.mocharc.json` es **60000 ms** y no debe bajarse: quedaría por debajo del `timeout: 60_000` que esos mismos tests usan en su `spawnSync`.

## El `timeout` de `.mocharc.json` es un suelo

Un `this.timeout(...)` o `suite.timeout(...)` local **por debajo** de ese valor lo endurece en silencio: el techo real pasa a ser el del override, aunque el config diga 60000. Es exactamente lo que ocurrió en `039A-1`: tres overrides de 30 s (`taskCoordinator`, `lease`, `gateRun`) sobrevivieron al arreglo del config y la suite volvió a fallar de forma intermitente con `Timeout of 30000ms exceeded` en un test que tarda ~24 s de trabajo git real.

Regla: todo override local debe ser **igual o mayor** que el valor del config. Los que suben (`shellMatrix` a 120 s, `workspaceReport` a 180 s) son correctos y deliberados.

Subir un override por encima del config no basta cuando el test es intermitente. Con el config ya en 60 s, las dos suites de `taskCoordinator.test.ts` fallaron con `Timeout of 60000ms exceeded`, y la **misma** suite pasó 591/1/0 en una segunda corrida sin tocar el código: los fallos eran de carga, no deterministas. Un techo con margen justo no sirve para certificar `suite: "passed"`, así que ambas se fijan en 180 s, igual que `workspaceReport`.

## Ejecutar un archivo aislado

`mocha <archivo>` **no acota la corrida si `.mocharc.json` declara `spec`**: el `spec` del config manda y el argumento posicional no lo reduce. Un «archivo aislado» puede estar corriendo la suite completa y dar un recuento parcial que parece limpio.

Antes de sacar conclusiones, comprueba el tamaño de la salida: la suite completa ronda las 1100 líneas y termina con `N passing`. Para medir timeouts, repite la suite; no te fíes de una corrida supuestamente acotada.

## Mapa de `src/test/suite`

Los tests se agrupan por dominio, espejo de `src/core/`, para que ninguna carpeta supere el umbral de `directorio-abarrotado` (más de 10 archivos de código hijos directos):

| Carpeta | Contenido |
| --- | --- |
| `guard/` | Guard, matrices de shell, interceptores y decisiones de política |
| `gate/` | Gate, scope, scheduler, lease, stages y cache |
| `task/` | Coordinador de tareas, recuperación y concurrencia |
| `diagnostico/` | Diagnose, avisos, índice de proyecto y equivalencia Sentinel |
| `cli-contratos/` | Contratos de CLI, API, formularios y seguridad |
| `css-react/` | Reglas CSS y React |
| `runtime-proyecto/` | Instalación, reglas portables, registro de extensiones e init |
| `rust/` | Reglas Rust |
| `reglas/` | Reglas de lote, sprints y líneas efectivas |
| `analisis/` | Analizadores estáticos, PHP, promesas y regex |

`.mocharc.json` usa `out/test/suite/**/*.test.js`. Los helpers de rutas (`__dirname`) de un test deben subir un `../` más que antes del movimiento.
