# Code Sentinel — Plan de Nuevas Detecciones

> Actualizado: Sprint 5 (5 nuevas reglas implementadas)

## Implementadas Sprint 5

- **componente-artesanal** (reactAnalyzer) — Detecta menus/dropdowns artesanales (outside-click handler manual) y modales artesanales (div overlay/backdrop con onClick). Sugiere usar `<MenuContextual>` y `<Modal>` del sistema de componentes.
- **fallo-sin-feedback** (reactAnalyzer) — Catch con solo console.error/log sin feedback visible al usuario (toast, setError, notificacion). P0 de auditoría frontend.
- **update-optimista-sin-rollback** (reactAnalyzer) — set() de Zustand antes de await sin set() de rollback en el catch. UI queda inconsistente si la API falla.
- **non-null-assertion-excesivo** (staticAnalyzer) — Detecta archivos con 5+ non-null assertions (!), indica tipos mal definidos. Severidad hint.
- **fetch-sin-timeout** (reactAnalyzer) — fetch() sin AbortController/signal. Puede colgar indefinidamente. Excluye archivos que son el wrapper HTTP.

## Implementadas anteriormente

### R72

- **error-enmascarado** (reactAnalyzer) — `ok: true` o `data: []` dentro de catch. P0 de auditoría frontend (9 funciones afectadas).
- **sanitizacion-faltante** (phpAnalyzer) — `$_GET`/`$_POST`/`$_REQUEST` sin sanitize_text_field/intval/etc.

### Mejoras R72

- **exec-sin-escapeshellarg** — eliminados 3 patrones de falso positivo.
- **json-decode-inseguro** — reescrita con reconocimiento de guards.
- **controller-sin-trycatch** — relajada detección.
- **barras-decorativas** — regex mejorada.

## Pendientes — Prioridad Alta

### PHP

- **[multi-tabla-sin-transaccion]** — Escribir en >1 tabla sin BEGIN/COMMIT. Complejidad: alta (requiere resolver nombres de tabla).

### React/TypeScript

- ~~**[update-optimista-sin-rollback]**~~ ✅ Sprint 5
- ~~**[fallo-sin-feedback]**~~ ✅ Sprint 5
- **[try-catch-faltante-ts]** — Parcialmente cubierta por `promise-sin-catch`. Pendiente para async functions sin try-catch. Complejidad: media.
- **[separacion-logica-vista]** — Cubierta por `componente-sin-hook-glory`. No requiere regla adicional.

## Pendientes — Prioridad Media

### General

- **[srp-violado]** — Archivo con múltiples exports de dominio distinto. Complejidad: muy alta, candidata para aiAnalyzer.

### TypeScript

- ~~**[non-null-assertion-excesivo]**~~ ✅ Sprint 5
- ~~**[promise-sin-catch]**~~ ✅ Sprint 2

## Pendientes — Prioridad Baja

- ~~**[n-plus-1-query]**~~ ✅ Sprint 3
- **[race-condition-create-get]** — Patrón buscar→crear sin lock/upsert. Candidata para aiAnalyzer.
- ~~**[fetch-sin-timeout]**~~ ✅ Sprint 5

## Notas de Implementación

- Reglas del phpAnalyzer que requieran scope de método completo pueden reutilizar el patrón de `verificarControllerSinTryCatch`.
- Para detecciones complejas (srp-violado, race-condition), delegar al aiAnalyzer.
- Cada nueva regla DEBE registrarse en `ruleRegistry.ts` para ser deshabilititable via settings.json.
- [Sprint 5]: Las reglas `componente-artesanal` y `fetch-sin-timeout` excluyen archivos que SON los componentes/wrappers relevantes para evitar falsos positivos.
