# Code Sentinel — Plan de Nuevas Detecciones

> Actualizado: R72 (auditoría sentinel 245 violaciones)

## Implementadas en esta iteración (R72)

- **error-enmascarado** (reactAnalyzer) — `ok: true` o `data: []` dentro de catch. P0 de auditoría frontend (9 funciones afectadas).
- **sanitizacion-faltante** (phpAnalyzer) — `$_GET`/`$_POST`/`$_REQUEST` sin sanitize_text_field/intval/etc.

## Mejoras a detecciones existentes (R72)

- **exec-sin-escapeshellarg** — eliminados 3 patrones de falso positivo: PDO::exec(), comandos literal, sprintf+escapeshellarg.
- **json-decode-inseguro** — reescrita con reconocimiento de `?? default`, ternary, is_string/isset guards. 100% de reports eran falso positivo.
- **controller-sin-trycatch** — relajada detección (try anywhere, no solo primera instrucción) + excluye métodos pure/const-return.
- **barras-decorativas** — regex ahora solo matchea líneas de comentario (`*, //, /*`), no código. Añadido `.css` a aplicaA.

## Pendientes — Prioridad Alta

### PHP

- **[endpoint-accede-bd]** — Controllers REST con queries `$wpdb` directas en vez de usar repos. Detección: buscar `$wpdb` o `$this->pg` dentro de archivos Controller. Excluir repositorios/servicios. Complejidad: media.

- **[multi-tabla-sin-transaccion]** — Escribir en >1 tabla sin BEGIN/COMMIT. Detección heurística: contar `->insert`/`->update`/`->delete` en un mismo método público con >1 tabla distinta. Complejidad: alta (requiere resolver nombres de tabla).

- **[open-redirect]** — `wp_redirect()` o `header('Location:')` con variable del request sin `wp_validate_redirect()`. Detección regex por línea + verificar contexto. Complejidad: baja.

- **[return-void-critico]** — Métodos con INSERT/UPDATE/DELETE que retornan void. Detección: parsear firma de método + buscar operaciones de escritura. Si return type es `: void` y tiene operaciones de BD, reportar. Complejidad: media.

### React/TypeScript

- **[update-optimista-sin-rollback]** — Detectar setState seguido de await sin verificación resp.ok y rollback. Heurística: setState → await fetch → sin `if (!resp.ok) { setState(snapshot) }`. Complejidad: alta.

- **[fallo-sin-feedback]** — Catch que solo tiene console.error sin toast/notificación visible. Heurística: catch block sin `toast(` ni `notificar(` ni `mostrarError(`. Complejidad: media.

- **[try-catch-faltante-ts]** — Llamadas a fetch/apiCliente sin try-catch en servicios TS (no solo useEffect). Complejidad: media.

- **[separacion-logica-vista]** — Componente con >5 líneas de lógica (useEffect/useState/calculos) sin hook dedicado. Heurística: contar líneas de lógica entre imports y return JSX. Complejidad: media.

## Pendientes — Prioridad Media

### General

- **[nomenclatura-css]** — Clases CSS no en español camelCase. Regex: `/\.(main|container|wrapper|button|header|footer|section|sidebar|content|nav)/` en archivos CSS. Complejidad: baja pero muchos falsos positivos potenciales con librerías.

- **[srp-violado]** — Archivo con múltiples exports de dominio distinto. Heurística: contar diferentes "dominios" (patrones import, export function). Complejidad: muy alta, probablemente requiere IA.

### TypeScript

- **[any-type]** — Parámetros o returns con tipo `any`. Regex simple pero ruidoso. Mejor como hint. Complejidad: baja.

- **[non-null-assertion-excesivo]** — Más de N `!` non-null assertions en un archivo. Complejidad: baja.

- **[promise-sin-catch]** — Promises sin `.catch()` ni await en try-catch. Complejidad: media.

## Pendientes — Prioridad Baja

- **[n-plus-1-query]** — Loop con query dentro (PHP). Heurística: `foreach`/`for`/`while` con `$wpdb->` o `$this->pg->` dentro. Complejidad: media.

- **[race-condition-create-get]** — Patrón buscar→crear sin lock/upsert. Detección por IA más que regex. Complejidad: muy alta.

- **[fetch-sin-timeout]** — fetch() en servicios sin AbortController/timeout. Complejidad: media.

## Notas de Implementación

- Reglas del phpAnalyzer que requieran scope de método completo pueden reutilizar el patrón de `verificarControllerSinTryCatch` (parseo de llaves + extracción de body).
- Para detecciones complejas (srp-violado, race-condition), considerar delegarlas al aiAnalyzer (análisis con LLM) en lugar de regex.
- Cada nueva regla DEBE registrarse en `ruleRegistry.ts` para ser deshabilititable via settings.json.
