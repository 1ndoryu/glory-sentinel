# Changelog
<!-- test de deteccion: 2026-02-20 -->

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
