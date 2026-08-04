# Changelog
<!-- test de deteccion: 2026-02-20 -->


> **Deprecacion IA:** el motor de analisis IA via vscode.lm se elimino en 0.4.0; toda deteccion es estatica y determinista.
## [0.4.0] - 2026-07-29

### Agregado
- Contrato CLI automatizable con `--files-from`, `--help`, `--version` y JSON versionado con conteos por severidad.
- Validación estricta de `sentinel.config.json`, incluyendo reglas y claves desconocidas.
- Pruebas de alcance incremental y seguridad de rutas.
- Reglas portables de arquitectura por boundaries (portableRules.ts) y portableBoundaries en config.
- Reglas unsafe-process-shell y default-export (esta ultima desactivada por defecto) en el registry.

### Mejorado
- El núcleo permanece agnóstico; las políticas específicas de cada consumidor se declaran en su configuración local.

## [0.2.4] - 2026-05-09

### Mejorado
- `npm run test:unit` ejecuta `check:core` y falla si `src/core/**` importa `vscode` fuera de `vscodeAdapter.ts`, preservando la arquitectura editor-agnostica.

## [0.1.0] - 2026-02-19

### Implementado
- Motor de analisis estatico con 13 reglas regex
- Analyzer especializado PHP/WordPress (controllers, $wpdb, json_decode, exec, curl, tempfiles)
- Analyzer especializado React (useEffect cleanup, mutacion de estado, Zustand selectors, console en catch)
- Analyzer especializado CSS (colores hardcodeados, nomenclatura ingles, barras decorativas)
- Motor de analisis IA via `vscode.lm` API con prompts segmentados por tipo de archivo
- Sistema de debounce con cooldown configurable para analisis estatico e IA
- Cache de resultados por hash de contenido
- CodeActionProvider con quick fixes para 5 tipos de violaciones
- Comando de supresion de reglas por linea (`sentinel-disable-next-line`)
- 5 comandos: analizar archivo, analizar workspace, limpiar, toggle IA, resumen de reglas
- Panel webview con resumen de reglas activas
- Configuracion completa via settings.json
- Tests unitarios para lineCounter y regex patterns
