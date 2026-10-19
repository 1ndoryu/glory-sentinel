# Roadmap — glory-sentinel

Meta activa: máxima calidad de Sentinel (arquitectura, repo limpio, instalación, CLI, docs, agnosticismo, coherencia, autogate).
Orden de ejecución: de arriba abajo. Cada bloque: probar en la 89, documentar, commitear, cerrar en `Agente/completados/`.

## Pendiente

- [ ] **S1 Higiene del repo.** Quitar `test-indexer.mjs` (lee una ruta de otro proyecto) y `test_cli.js` (UTF-16, una línea). Mover `PLAN_*.md` de la raíz a `Agente/planes/` (V3 y MEJORA_V2 a `completados/`).
- [ ] **S2 Versión única.** `package.json` (0.7.26) es la fuente. Alinear `README.md` (líneas 117, 199) y la ayuda. Añadir entrada al CHANGELOG para 0.7.24–0.7.26 o dejar constancia de que no hubo release.
- [ ] **S3 Catálogo de reglas desde el registro.** `rules.md` dice 106 y el registro tiene 121. Generarlo desde `src/config/ruleRegistry.ts` con un script y comprobarlo en `test:unit` para que no vuelva a derivar.
- [ ] **S4 Ayuda única.** `help.txt` está desfasado (0.7.23, sin `--without-path`, `--profile`, `--env-manifest`, `--worktrees-root`). Quitarlo y que la ayuda salga solo de `src/cli/args.ts`.
- [ ] **S5 Instalación en una vía.** README menciona `gate:check`, que no existe en `package.json` (líneas 103 y 151). Documentar solo `git clone` + `npm ci` + `npm run compile` + ruta, y declarar `engines.node`.
- [ ] **S6 Arquitectura.** `src/core/analyzeDocument.ts` importa analyzers (dependencia invertida core→analyzers). Invertirla con un contrato explícito. Dar budget a `src/analyzers/rustReglasNuevas.ts` (1527 líneas).
- [ ] **S7 Optimización.** `src/core/scope.ts:80` usa 64 MB de buffer: acotarlo. Revisar timeouts de `externalToolsAnalyzer.ts:281`.
- [ ] **S8 Docs de dominio.** `README.md:211-247` contiene narrativa interna (039A-1, timeouts): mover a `docs/`.
- [ ] **S9 Autogate.** `Arranque` no tiene ficha para este proyecto (noAplica sin-servicio). Gate vía `POST /api/gate/analizar` (`AGENTS-detalle.md:37`). Tests solo en la 89.

## Bloqueos
- Tests en la 89: el proyecto no está en `~/taller` (sin réplica Mutagen). Se verifica con clon en `/var/tmp` de la 89 desde `origin` (sin tocar `~/taller`).
- `npm publish`/release a terceros: reservado a la usuaria (AGENTS §3).
