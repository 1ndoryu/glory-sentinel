# Roadmap — glory-sentinel

Meta activa: máxima calidad de Sentinel (arquitectura, repo limpio, instalación, CLI, docs, agnosticismo, coherencia, autogate).
Orden de ejecución: de arriba abajo. Cada bloque: probar en la 89, documentar, commitear, cerrar en `Agente/completados/`.

## Pendiente

- [ ] **S10 Tests agnósticos del SO.** `src/core/guardLog.ts:21` y tests fijan `C:/tmp` en win32 (convención del área dentro del producto). Pasar la carpeta a configuración con fallback a `os.tmpdir()`; tests sin rutas fijas. Causa de 2 de los 3 fallos en la 89.
- [ ] **S11 Tests de shells hermético.** `src/test/suite/shellMatrix.test.ts` depende de bash/cargo reales y códigos de salida de Windows: 2 fallos en la 89 (`EXIT:78`, `EXIT:127`). Marcar como condicionales al entorno o aislarlos.
- [ ] **S12 Lint.** `src/core/interceptorShims.ts:169` error `no-useless-escape`; 13 warnings de `no-unused-vars` / `no-explicit-any`. Dejar lint a 0.
- [ ] **S6 Arquitectura.** `src/core/analyzeDocument.ts` importa analyzers (core→analyzers). Invertir con un contrato explícito. Budget para `src/analyzers/rustReglasNuevas.ts` (1527 líneas).
- [ ] **S7 Optimización.** `src/core/scope.ts:80` usa buffer de 64 MB: acotarlo. Revisar timeouts de `externalToolsAnalyzer.ts:281`.
- [ ] **S8 Docs de dominio.** `README.md:211-247` contiene narrativa interna (039A-1, timeouts): mover a `docs/`.
- [ ] **S9 Autogate.** Sin ficha de Arranque (noAplica sin-servicio). Gate vía `POST /api/gate/analizar` (`AGENTS-detalle.md:37`). Tests en la 89.

## Decisiones pendientes de la usuaria
- Tags y release: crear `v0.7.26` (o declarar 0.7.23 vigente). Reservado a la usuaria (AGENTS §3).

## Bloqueos
- Verificación en la 89: clon de `HEAD` en `/var/tmp/glory-sentinel-verify` (no toca `~/taller`).
- Publicar o hacer release a terceros: reservado a la usuaria (AGENTS §3).

## Hecho
- S2 Versión única (2026-10-19): `package.json` 0.7.26 es la fuente; `README.md` declara 0.7.23 como último tag y 0.7.26 sin etiquetar; CHANGELOG `[Unreleased]` recoge 0.7.24–0.7.26. La ayuda no lleva versión fija.
- S5 Instalación en una vía (2026-10-19): el README documenta un único camino (`git checkout v0.7.23` → `npm ci` → `npm run compile` → `install`), sin tag nuevo.
- S3 Catálogo generado (2026-10-19): `scripts/catalogo-reglas.mjs` escribe `rules.md` desde el registro (121 reglas, antes 106) y `check:reglas` entra en `test:unit`. Verificado en la 89.
- S4 Ayuda única (2026-10-19): `help.txt` retirado; `sentinel --help` sale de `src/cli/args.ts`.
- Engines: `node >=20` declarado (inferido de @types/node 20; probado en Node 24.21).
- S1 Higiene del repo (2026-10-19): `test-indexer.mjs`, `test_cli.js` fuera; planes a `Agente/planes/`. Verificado en la 89: compile, check:core, smoke:lsp OK; `test:unit` 908 pasan, 3 fallan (S10, S11; preexistentes, no del bloque).
