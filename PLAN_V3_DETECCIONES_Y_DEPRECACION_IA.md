# Glory Sentinel v3 — Plan de Nuevas Detecciones + Eliminación IA

> **Fecha:** 07/03/2026
> **Completado:** 08/03/2026 (S7-S10)
> **Origen:** Auditoría plan-sync-mejoras-v2.md reveló 22 hallazgos (3 críticos PHP, 2 críticos TS, 14 altos/medios) que Sentinel NO detectó.
> **Objetivo:** Cerrar los gaps de detección con reglas estáticas deterministas y eliminar toda dependencia de IA.
> **Estado:** ✅ COMPLETADO — 13 reglas nuevas + 3 enhancements + IA eliminada + 205 tests passing.

---

## Diagnóstico: ¿Por qué Sentinel no detectó los hallazgos?

### Hallazgos que Sentinel YA tenía regla pero NO detectó (posibles bugs):

| Hallazgo | Regla existente | Problema probable |
|----------|----------------|-------------------|
| M1 — json_decode silencioso `$samples = []` | `json-decode-inseguro` | La regla busca `json_decode()` sin `json_last_error()` en cercanía. Pero el patrón real es `$x = json_decode(...) ?: []` — el fallback `?: []` enmascara el error sin verificar `json_last_error`. La regla no cubre este patrón. |
| M3 — `incrementarDescargas()` retorna void | `return-void-critico` | La regla busca `: void` en métodos con INSERT/UPDATE/DELETE en su cuerpo. Pero nombres como `incrementar*` usan UPDATE internamente sin tener `: void` explícito — la detección depende del return type hint, si no está declarado no se analiza. |
| TA6 — syncService.ts 800+ LOC | `limite-lineas` | Debería haberlo detectado. Posible bug: el archivo está en `desktop/src/services/`, y la regla puede no estar clasificando correctamente archivos fuera de `App/React/`. Verificar que el analizador procesa archivos del directorio `desktop/`. |

### Hallazgos que requieren NUEVAS reglas (13 reglas nuevas):

#### PHP — 8 reglas nuevas

| # | ID propuesto | Hallazgo origen | Patrón a detectar | Severidad | Esfuerzo |
|---|-------------|-----------------|-------------------|-----------|----------|
| 1 | `toctou-select-insert` | C1 (race posición) | `SELECT MAX/COUNT` seguido de `INSERT` en el mismo método, misma tabla, sin estar en una sola query atómica ni dentro de `BEGIN/COMMIT` | error | Alto |
| 2 | `lock-sin-finally` | C2/A2 (advisory leak) | `advisoryLock`/`pg_advisory_lock` sin bloque `finally` que contenga `unlock`/`pg_advisory_unlock`. También aplica a cualquier `flock()` sin finally. | error | Medio |
| 3 | `catch-critico-solo-log` | C3 (revenue silent fail) | Método cuyo nombre contiene `revenue`/`pago`/`transaccion`/`cobro`/`factur` tiene catch que solo contiene `log`/`Logger` sin re-throw ni return false/error | warning | Medio |
| 4 | `mime-type-cliente` | A1 (MIME spoofing) | `$archivo['type']` / `$_FILES['...']['type']` usado en validación (if/switch/in_array) sin presencia de `mime_content_type` o `finfo_` en el mismo método | error | Bajo |
| 5 | `cadena-isset-update` | A4 (violación OCP) | Método con 5+ bloques `if (isset($body[` o `if (isset($datos[` consecutivos (señal de strategy pattern faltante) | warning | Bajo |
| 6 | `query-doble-verificacion` | A5 (roundtrip doble) | Método que hace query de verificación (`COUNT(*)`/`SELECT ... WHERE id =`) seguido de query de datos sobre la misma tabla en <20 líneas | information | Medio |
| 7 | `json-sin-limite-bd` | A8 (metadata sin límite) | `json_encode($var)` que se pasa a INSERT/UPDATE (o a método de repository) sin verificación de `strlen` previa | warning | Medio |
| 8 | `retorno-ignorado-repo` | M4 (changelog sin check) | Llamada a método de Repository/Service cuyo nombre sugiere escritura (`registrar`/`guardar`/`insertar`/`actualizar`/`crear`) donde el valor de retorno no se captura en variable ni se usa en condición | warning | Medio |

#### TypeScript — 5 reglas nuevas

| # | ID propuesto | Hallazgo origen | Patrón a detectar | Severidad | Esfuerzo |
|---|-------------|-----------------|-------------------|-----------|----------|
| 9 | `listen-sin-cleanup` | TA1 (memory leak) | `listen(` de Tauri (o `addEventListener`) cuyo retorno (unlisten/unsubscribe) no se almacena en variable o no aparece en un `detener`/`cleanup`/`dispose`/`return` del mismo scope | warning | Medio |
| 10 | `status-http-generico` | TA2 (409 indiscriminado) | `=== 409` o `=== 401` etc. en condición que marca éxito sin inspeccionar body/response.data (ej: `if (status === 409) { marcarExito() }`) | warning | Medio |
| 11 | `handler-sin-trycatch` | TA4 (rename sin protección) | Funciones pasadas como callback a `listen()`, `on()`, `addEventListener()` cuyo cuerpo no tiene try-catch y contiene await (async handlers sin protección) | warning | Medio |
| 12 | `cola-sin-limite` | TM5 (queue sin tope) | Array usado como cola/buffer (`.push()` en función de enqueue/agregar/encolar) sin verificación de `.length` contra máximo previo al push | information | Bajo |
| 13 | `objeto-mutable-exportado` | TM2 (estado compartido) | `export const` de objeto literal `{}` o array `[]` mutable que se muta directamente con `.push()`, `[key] =`, etc. en otros archivos (señal de estado compartido sin protección) | information | Medio |

### Mejoras a reglas existentes (3 enhancements):

| Regla existente | Mejora | Hallazgo |
|----------------|--------|----------|
| `json-decode-inseguro` | Detectar también patrón `$x = json_decode(...) ?: []` y `$x = json_decode(...) ?? []` como fallback silencioso sin `json_last_error()` | M1 |
| `return-void-critico` | Buscar también métodos PHP SIN return type hint que solo hacen UPDATE/INSERT (no solo los que tienen `: void` explícito). Heurística: método con query de escritura y sin `return` statement | M3 |
| `limite-lineas` | Asegurar que también procesa archivos en `desktop/src/` además de `App/React/`. Verificar que el `exclude` pattern no filtra archivos desktop | TA6 |

---

## PARTE 2 — ELIMINACIÓN COMPLETA DE IA

### Justificación

La IA en Sentinel no resulta eficiente ni útil:
- Alto consumo de créditos Copilot con resultados inconsistentes
- Falsos positivos frecuentes que obligaron a descartar 7 reglas del análisis IA
- Latencia alta (5-30s delay) para resultados que no mejoran significativamente sobre el análisis estático
- Complejidad de infraestructura desproporcionada: cola IA, rate limiting, cooldown, cache por hash, debounce diferenciado, dos backends (Copilot + Gemini CLI)
- Las detecciones realmente útiles son las estáticas deterministas — rápidas, sin costo, reproducibles

### Inventario de código IA a eliminar

#### Archivos a ELIMINAR completamente:
| Archivo | Líneas | Razón |
|---------|--------|-------|
| `src/analyzers/aiAnalyzer.ts` | ~363 | Motor IA completo (Copilot + Gemini CLI) |
| `src/config/prompts.ts` | ~94 | Construcción de prompts para IA |

#### Archivos a MODIFICAR (eliminar secciones IA):

| Archivo | Qué eliminar |
|---------|-------------|
| `src/types/index.ts` | `ReglaSemantica`, `RespuestaIA`, `ViolacionIA`, campo `iaAnalizado` si existe, `CategoriaRegla.SemanticaIA`, campos `ai*` de `ConfiguracionSentinel`, campos `*IA` de `EstadoArchivo` |
| `src/extension.ts` | Comando `codeSentinel.toggleAI`, variable `iaHabilitada`, import de `analizarConIA`, cualquier referencia a IA en status bar o mensajes |
| `src/providers/diagnosticProvider.ts` | Llamadas a `analizarConIA()`, merge de resultados IA, source `'sentinel-ia'`, lógica de delay IA, cola IA. Mantener solo flujo estático. |
| `src/services/debounceService.ts` | Cola IA (`colaIA`), `iaEnProgreso`, `programarAnalisisIA()`, rate limiting IA, cooldown IA (`aiCooldownMs`). Simplificar a un debounce puro para análisis estático. |
| `src/services/cacheService.ts` | Campo `iaAnalizado`, lógica de "nunca ejecutado IA vs sin violaciones IA". Simplificar cache a solo resultados estáticos. |
| `package.json` | Settings: `codeSentinel.aiAnalysis.enabled`, `codeSentinel.ai.modelFamily`, `codeSentinel.ai.backend`, `codeSentinel.ai.geminiModel`, `codeSentinel.timing.aiDelayOnOpen`, `codeSentinel.timing.aiDelayOnEdit`, `codeSentinel.timing.aiCooldown`, `codeSentinel.timing.aiTimeout`, `codeSentinel.limits.maxAiRequestsPerMinute`, `codeSentinel.limits.maxFileSizeForAiKb`. Comando `codeSentinel.toggleAI`. |
| `.gemini/` | Directorio completo de configuración Gemini CLI |

#### Campo `fuente` en Violacion:
- Actualmente: `'estatico' | 'ia'`
- Cambiar a: `'estatico'` (valor fijo, mantener el campo por compatibilidad con reportes existentes)
- O eliminar el campo si no se usa externamente

### Beneficios post-eliminación:
- **~500 líneas menos** de código complejo
- **0 dependencia** de APIs externas o modelos
- **Análisis instantáneo** (<500ms siempre, sin delays de 5-30s)
- **Sin consumo de créditos** (Copilot/Gemini)
- **Determinismo** — misma entrada = mismo resultado, siempre
- **Simplicidad** — debounceService se reduce a un timer simple, cacheService trivial

---

## PARTE 3 — ARQUITECTURA DE IMPLEMENTACIÓN

### Ubicación de nuevas reglas por analyzer:

```
src/analyzers/
├── php/
│   ├── phpControllerRules.ts  ← lock-sin-finally, catch-critico-solo-log
│   ├── phpDataRules.ts        ← toctou-select-insert, json-sin-limite-bd, retorno-ignorado-repo, query-doble-verificacion
│   └── phpSecurityRules.ts    ← mime-type-cliente
├── react/
│   ├── reactHookRules.ts      ← listen-sin-cleanup
│   ├── reactErrorRules.ts     ← status-http-generico, handler-sin-trycatch
│   └── reactComponentRules.ts ← objeto-mutable-exportado, cola-sin-limite
├── static/
│   └── staticCodeRules.ts     ← cadena-isset-update (genérico PHP)
└── glory/
    └── (sin cambios — reglas existentes cubren schema/enums)
```

### Patrón de implementación por regla (ejemplo):

```typescript
/* Regla: lock-sin-finally
 * Detecta advisory lock sin bloque finally para cleanup.
 * Busca advisoryLock/pg_advisory_lock en el método, luego verifica
 * que existe un bloque finally con advisoryUnlock/pg_advisory_unlock.
 */
function verificarLockSinFinally(lineas: string[], rutaArchivo: string): Violacion[] {
  const violaciones: Violacion[] = [];
  for (let i = 0; i < lineas.length; i++) {
    if (/advisory[Ll]ock|pg_advisory_lock/.test(lineas[i])) {
      /* Buscar finally con unlock en las siguientes 100 líneas */
      const bloque = lineas.slice(i, i + 100).join('\n');
      const tieneFinally = /finally\s*\{[^}]*(?:advisory[Uu]nlock|pg_advisory_unlock)/s.test(bloque);
      if (!tieneFinally) {
        violaciones.push({
          reglaId: 'lock-sin-finally',
          mensaje: 'Advisory lock sin bloque finally para garantizar liberación. Riesgo de lock huérfano.',
          severidad: 'error',
          linea: i,
          fuente: 'estatico',
        });
      }
    }
  }
  return violaciones;
}
```

---

## PARTE 4 — PLAN DE EJECUCIÓN POR SPRINTS

### Sprint 7 — Eliminación IA (~2-3h)

| Paso | Acción | Archivos |
|------|--------|----------|
| 7.1 | Eliminar `aiAnalyzer.ts` y `prompts.ts` | 2 archivos eliminados |
| 7.2 | Limpiar types: eliminar `ReglaSemantica`, `RespuestaIA`, `ViolacionIA`, `SemanticaIA`, campos AI de config | `types/index.ts` |
| 7.3 | Limpiar `extension.ts`: eliminar toggleAI, import IA, iaHabilitada | `extension.ts` |
| 7.4 | Simplificar `diagnosticProvider.ts`: eliminar flujo IA, mantener solo estático | `diagnosticProvider.ts` |
| 7.5 | Simplificar `debounceService.ts`: eliminar cola IA, rate limiting, cooldown | `debounceService.ts` |
| 7.6 | Simplificar `cacheService.ts`: eliminar iaAnalizado | `cacheService.ts` |
| 7.7 | Limpiar `package.json`: eliminar settings y comando IA | `package.json` |
| 7.8 | Eliminar `.gemini/` si existe | directorio |
| 7.9 | Compilar + ejecutar tests existentes. Corregir lo que rompa. | `npm run compile && npm test` |

### Sprint 8 — Reglas PHP nuevas (~4-5h)

| Paso | Regla | Prioridad | Esfuerzo |
|------|-------|-----------|----------|
| 8.1 | `lock-sin-finally` (C2/A2) | P0 | 45 min |
| 8.2 | `mime-type-cliente` (A1) | P0 | 30 min |
| 8.3 | `toctou-select-insert` (C1) | P0 | 1.5h |
| 8.4 | `catch-critico-solo-log` (C3) | P1 | 1h |
| 8.5 | `retorno-ignorado-repo` (M4) | P1 | 1h |
| 8.6 | `cadena-isset-update` (A4) | P2 | 30 min |
| 8.7 | `json-sin-limite-bd` (A8) | P2 | 45 min |
| 8.8 | `query-doble-verificacion` (A5) | P2 | 1h |

### Sprint 9 — Reglas TS nuevas + enhancements (~3-4h)

| Paso | Regla | Prioridad | Esfuerzo |
|------|-------|-----------|----------|
| 9.1 | `listen-sin-cleanup` (TA1) | P0 | 1h |
| 9.2 | `handler-sin-trycatch` (TA4) | P1 | 45 min |
| 9.3 | `status-http-generico` (TA2) | P1 | 45 min |
| 9.4 | `cola-sin-limite` (TM5) | P2 | 30 min |
| 9.5 | `objeto-mutable-exportado` (TM2) | P2 | 1h |
| 9.6 | Enhancement: `json-decode-inseguro` (cubrir `?: []`) | P1 | 20 min |
| 9.7 | Enhancement: `return-void-critico` (sin type hint) | P1 | 30 min |
| 9.8 | Enhancement: `limite-lineas` (cubrir desktop/) | P0 | 15 min |

### Sprint 10 — Tests + validación (~2h)

| Paso | Acción |
|------|--------|
| 10.1 | Tests unitarios para cada regla nueva (mínimo 2 por regla: caso positivo + negativo) |
| 10.2 | Ejecutar análisis workspace completo sobre glorytemplate como smoke test |
| 10.3 | Verificar que los hallazgos del plan-sync-mejoras-v2.md ahora sí se detectan |
| 10.4 | Actualizar `rules.md` con las reglas nuevas |
| 10.5 | Actualizar `README.md` con los cambios (sin IA + nuevas detecciones) |
| 10.6 | Bump versión a 0.2.0 en `package.json` y `CHANGELOG.md` |

---

## PARTE 5 — REGLAS QUE NO SON DETECTABLES ESTÁTICAMENTE

Estos hallazgos NO se pueden cubrir con reglas regex/heurísticas y requieren revisión humana:

| Hallazgo | Razón |
|----------|-------|
| C3 opciones A/B (política de negocio) | Decisión arquitectónica, no patrón de código |
| A3 (SRP en controller) | Medir responsabilidades mezcladas requiere análisis semántico profundo. `limite-lineas` cubre parcialmente. |
| A7 (estados transitorios en queries) | Demasiado específico del dominio de negocio |
| TC1 (cross-window race en Store) | Requiere análisis de flujo de datos inter-proceso |
| TC2 (dedup race entre hash y enqueue) | Requiere análisis de concurrencia temporal |
| TA5 (race en inicialización multi-window) | Requiere análisis de concurrencia multi-proceso |
| TM3 (coexistencia v1/v2) | Decisión de migración, no patrón |
| TM4 (hash post-descarga) | Feature faltante, no patrón detectabe |
| M2 (re-query antes de INSERT) | Requiere análisis de flujo temporal (query al inicio, INSERT al final) — falsos positivos altos |
| M6 (política purga sin documentar) | Problema de documentación, no de código |

---

## Métricas de éxito

| Métrica | Antes (v0.1) | Objetivo (v0.2) |
|---------|-------------|-----------------|
| Reglas activas totales | ~52 estáticas + IA | ~65 estáticas (sin IA) |
| Race conditions detectables | 0 | 2 (toctou-select-insert, lock-sin-finally) |
| Fallos silenciosos detectables | 2 (json-decode, catch-vacio) | 6 (+catch-critico, retorno-ignorado, json-sin-limite, status-generico) |
| Memory leaks detectables | 1 (useeffect-sin-cleanup) | 2 (+listen-sin-cleanup) |
| Seguridad upload detectables | 0 | 1 (mime-type-cliente) |
| Latencia análisis | 500ms-30s (con IA) | <500ms (solo estático) |
| Dependencias externas | Copilot API + Gemini CLI | 0 |
| Código total extensión | ~4500 LOC | ~4000 LOC (neto con reglas nuevas) |
