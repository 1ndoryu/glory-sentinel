# Roadmap — glory-sentinel

Meta activa: máxima calidad de Sentinel (arquitectura, repo limpio, instalación, CLI, docs, agnosticismo, coherencia, autogate).
Orden de ejecución: de arriba abajo. Cada bloque: probar en la 89, documentar, commitear, cerrar en `Agente/completados/`.

## Pendiente

- [ ] **S6 Arquitectura.** `src/core/analyzeDocument.ts` importa analyzers (core→analyzers). Invertir con un contrato explícito. Budget para `src/analyzers/rustReglasNuevas.ts` (1527 líneas).
- [ ] **S7 Optimización.** `src/core/scope.ts:80` usa buffer de 64 MB: acotarlo. Revisar timeouts de `externalToolsAnalyzer.ts:281`.
- [ ] **S8 Docs de dominio.** `README.md:211-247` contiene narrativa interna (039A-1, timeouts): mover a `docs/`.
- [ ] **S9 Autogate.** Sin ficha de Arranque (noAplica sin-servicio). Gate vía `POST /api/gate/analizar` (`AGENTS-detalle.md:37`). Tests en la 89.

- Gate de RESTAURANTE (10AA-3, 2026-10-19): Sentinel se ejecuta en la 89 desde `/var/tmp/gate-tools/sentinel` (archive de `b4d043b`, versión 0.7.26; el adaptador comprueba `.quality-pin` y `--version` antes de cada análisis), no desde `tools/sentinel` de los submódulos de la 89, que están sucios por otra sesión. Pendiente de quien lleva Sentinel: decidir si el submódulo de la 89 se fija a ese pin o el pin se declara de otra forma. No tocado desde RESTAURANTE.

## Decisiones pendientes de la usuaria
- Tags y release: crear `v0.7.26` (o declarar 0.7.23 vigente). Reservado a la usuaria (AGENTS §3).

## Bloqueos
- Verificación en la 89: clon de `HEAD` en `/var/tmp/glory-sentinel-verify` (no toca `~/taller`).
- Publicar o hacer release a terceros: reservado a la usuaria (AGENTS §3).

## Hecho
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
