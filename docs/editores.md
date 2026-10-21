# Editores: extensión de VS Code y LSP

Sentinel ofrece dos superficies de edición que consumen el mismo motor de análisis que el CLI.

## Extensión de VS Code

La extensión se instala desde el paquete `.vsix` que genera el proyecto (`npm run compile` seguido de `vsce package`; el empaquetado lo hace el mantenedor). Es un componente aparte del CLI: el CLI de Sentinel se instala solo con `npm run install:sentinel`. Diagnósticos en vivo al editar y comandos sobre archivo o workspace.

Comandos (`Ctrl+Shift+P`):

| Comando                       | Qué hace                                              |
|-------------------------------|-------------------------------------------------------|
| `codeSentinel.analyzeFile`    | Analiza el archivo activo                             |
| `codeSentinel.analyzeWorkspace` | Analiza el workspace completo                       |
| `codeSentinel.clearDiagnostics` | Limpia los diagnósticos de Sentinel                 |
| `codeSentinel.showRulesSummary` | Muestra el resumen de reglas activas                |
| `codeSentinel.runExternalTools` | Ejecuta las herramientas externas configuradas      |

Ajustes (`settings.json`, prefijo `codeSentinel.`):

| Ajuste                              | Efecto                                                    |
|-------------------------------------|-----------------------------------------------------------|
| `staticAnalysis.enabled`            | Activa o desactiva el análisis estático                   |
| `timing.staticDebounce`             | Retardo (ms) antes de analizar tras editar                |
| `rules`                             | Habilitación o severidad por regla                        |
| `reportPath`                        | Ruta del reporte generado                                 |
| `exclude`                           | Patrones excluidos del análisis                           |
| `directoryExceptions`               | Directorios exentos                                       |
| `languages`                         | Lenguajes analizados                                      |

## LSP `sentinel-lsp`

Para editores compatibles con Language Server Protocol (Zed, Neovim, Helix y similares), el binario `sentinel-lsp` habla por stdio:

```bash
sentinel-lsp --stdio
```

Si el paquete está instalado globalmente (`npm install -g`), el comando queda en el PATH. Desde un checkout sin instalar, usa `node out/lsp/server.js --stdio` tras `npm run compile`.

El LSP lee `sentinel.config.json` de la raíz del workspace, igual que el CLI. Al recargar el workspace se descarta el índice de clases cacheado y se reconstruye desde disco. Smoke de referencia: `npm run smoke:lsp`.

Ver [configuración](configuration.md) para las claves del análisis.
