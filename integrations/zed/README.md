# Glory Sentinel para Zed

Esta carpeta contiene la integracion minima de Zed para Glory Sentinel. La extension no incluye reglas propias: registra `sentinel-lsp` y deja que el servidor LSP de Node publique diagnostics desde el mismo core que usan VS Code y la CLI.

## Desarrollo local

1. Desde la raiz de Glory Sentinel, instala dependencias y compila:

```bash
npm install
npm run compile
```

2. En Zed, ejecuta `zed: install dev extension` y selecciona `integrations/zed`.

3. Abre un archivo CSS, TSX, JSX, TS, JS, PHP o Rust. Zed debe iniciar `node ../../out/lsp/server.js --stdio` desde esta carpeta.

## Resolucion del LSP

La integracion busca el servidor en este orden:

1. `SENTINEL_LSP_PATH`, para apuntar a un binario o script concreto.
2. `sentinel-lsp` disponible en el `PATH` del worktree.
3. `../../out/lsp/server.js`, pensado para desarrollo dentro de este repo.

Si la ruta termina en `.js`, la integracion usa `zed::node_binary_path()` y pasa `--stdio`. Para binarios o shims de npm, ejecuta la ruta directamente con `--stdio`.

## Tareas CLI

La raiz del repo incluye `.zed/tasks.json` con tareas de ejemplo para generar reportes desde la CLI. En un proyecto consumidor se puede copiar esa carpeta o adaptar los comandos a una instalacion global de `sentinel`.

## Publicacion

Para publicar en el registro de Zed, esta carpeta debe usarse como `path` del submodulo y conservar una licencia aceptada en la misma ruta. El LSP no debe duplicar reglas dentro de la extension publicada; debe localizarse, descargarse o verificarse en el entorno del usuario.
