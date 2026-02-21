# Code Sentinel — Plan de Mejora Progresiva v2.0

> Revision profunda de la extension. Objetivo: convertirla en arma de enforcement arquitectonico,
> no solo detector de patrones prohibidos.

---

## Diagnostico del Estado Actual

### Lo que funciona bien

- **24 reglas activas** (10 regex + 10 PHP contextual + 4 React contextual)
- phpAnalyzer robusto: wpdb-sin-prepare con exclusiones DDL/transacciones/ventana contextual
- reactAnalyzer: useEffect-sin-cleanup, mutacion-estado, zustand-sin-selector, error-enmascarado
- Sistema de reglas deshabilitables via settings.json
- Cache por hash de archivo + debounce inteligente
- IA dual: Copilot vscode.lm + Gemini CLI
- sentinel-disable-next-line para supresion inline
- Falsos positivos corregidos iterativamente (R72-R74)

### Gaps criticos identificados

1. **Sin deteccion de hardcoded SQL vs Schema System (Cols/Enums/DTO)**
   - El proyecto tiene 18 schemas con Cols y 10 Enums auto-generados
   - Muchos repositorios usan correctamente `SamplesCols::TITULO`, pero hay violaciones residuales
   - Ejemplo real: ConversacionesRepository usa `participante_1` string literal porque `ConversacionesCols` no incluye esa columna (TO-DO existente en L47)
   - No hay deteccion automatica de strings que deberian usar constantes Cols

2. **Sin deteccion Glory-especifica**
   - No detecta si un controller accede a BD directamente (bypass repository pattern)
   - No detecta si un componente React no sigue la separacion isla+hook de Glory
   - No detecta si `PageManager::reactPage()` tiene islas no registradas en appIslands.tsx
   - No detecta si Enums de CHECK constraints se usan como strings hardcodeados

3. **Rendimiento TS/TSX**
   - zustand-sin-selector implementado pero solo busca `useStore()` sin args
   - No detecta destructuring completo sin selector: `const {x,y,z} = useStore(s => s)` (pasa el selector pero re-renderiza igual)
   - No detecta re-renders por nuevas referencias en selector: `useStore(s => ({ a: s.a, b: s.b }))` (crea objeto nuevo cada render)
   - No detecta props drilling vs composicion
   - No detecta `key={index}` en listas dinamicas

4. **Seguridad PHP avanzada**
   - sanitizacion-faltante implementada pero solo $_GET/$_POST/$_REQUEST
   - No detecta `$request->get_param()` sin sanitizar (patron WordPress REST)
   - No detecta INTERVAL injection (P0 detectado en auditoria-seguridad-php.md)
   - No detecta open-redirect (listado en PLAN_DETECCIONES pero no implementado)
   - No detecta SSRF en file_get_contents con URL de usuario

5. **Performance PHP**
   - No detecta N+1 queries (listado como prioridad baja)
   - No detecta queries duplicados en mismo metodo
   - No detecta falta de indices en queries frecuentes (scope de BD, fuera de extension)

6. **Arquitectura general**
   - No detecta archivos que mezclan dominios
   - No detecta falta de typing en funciones PHP (return types, param types)
   - No detecta componentes sin ErrorBoundary en islas principales

---

## Plan de Mejora Progresivo (3 Sprints)

### Sprint 1 — Glory Schema Enforcement + Seguridad (Prioridad CRITICA) ✅ COMPLETADO

> **Completado:** 21/02/2026. Implementado en `gloryAnalyzer.ts` (nuevo analyzer).
> 6 reglas nuevas registradas en ruleRegistry, categoria GlorySchema agregada.
> Schema se carga al activar con FileSystemWatcher para invalidar cache automaticamente.
>
> **Fix post-auditoria:** Gaps de deteccion corregidos:
> - hardcoded-sql-column: Ahora detecta arrays planos de whitelists (`$permitidos = ['col1', ...]`)
> - endpoint-accede-bd: Ahora cubre `Service` files (no solo Controller/Endpoints)
> - endpoint-accede-bd: Exclusion de servicios de infraestructura (CacheService, LogService)
> - return-void-critico: DDL (ALTER TABLE, CREATE TABLE, DROP TABLE, TRUNCATE) incluido
> - endpoint-accede-bd: Mejor regex para $wpdb (solo metodos especificos, no generico)

#### 1.1 `[hardcoded-sql-column]` — Strings de columnas que deberian usar Cols (NUEVO)

**Problema:** Archivos PHP dentro de repositorios/servicios usan strings literales para nombres de columnas
de tablas que tienen Cols auto-generados. Es el problema mas frecuente del proyecto.

**Complejidad:** Media-alta. Requiere:
1. Escanear `App/Config/Schema/_generated/*Cols.php` al activar para construir mapa tabla->columnas
2. En cada archivo PHP, detectar strings literales en contexto SQL que coincidan con columnas conocidas
3. Excluir: parametros PDO (:nombre), aliases SQL (AS nombre), _generated/, comentarios, constantes

**Deteccion heuristica (staticAnalyzer):**
```
Contexto SQL detectado (SELECT/INSERT/UPDATE/DELETE/WHERE/ORDER BY/JOIN cerca):
  - String literal 'nombre_columna' que existe en alguna tabla del mapa Cols
  - $row['nombre_columna'] donde nombre_columna existe en el esquema
  - Array key 'nombre_columna' en inserts/updates
```

**Exclusiones:**
- Archivos dentro de `_generated/` (auto-generados)
- Archivos de migraciones
- SQL aliases (AS nombre)
- Parametros PDO (:nombre)
- Strings dentro de comentarios
- Valores de columna (no confundir 'activo' en WHERE con nombre de columna 'activo')
  - Diferenciar: `WHERE estado = 'activo'` (el 'activo' es VALOR, 'estado' es COLUMNA)

**Implementacion:** Nuevo `gloryAnalyzer.ts` (analyzer especializado Glory, separado de phpAnalyzer).

**Severidad:** Warning (no Error, porque puede haber alias o SQL legacy)

**Quick fix sugerido:** Mostrar en el mensaje que constante usar:
`"'titulo' deberia usar SamplesCols::TITULO (App\Config\Schema\_generated\SamplesCols)"`

#### 1.2 `[hardcoded-enum-value]` — Valores de CHECK que deberian usar Enums (NUEVO)

**Problema:** Strings como `'activo'`, `'sample'`, `'like'`, `'completed'` se usan directamente
en vez de `SamplesEnums::ESTADO_ACTIVO`, `LikesEnums::TIPO_SAMPLE`, etc.

**Deteccion:**
1. Leer todos los `*Enums.php` para construir mapa valor->constante
2. En archivos PHP, buscar strings literales que coincidan con valores enum en contexto SQL/logica
3. Contextos: comparaciones (`=== 'activo'`), asignaciones (`$estado = 'activo'`), SQL WHERE

**Exclusiones:**
- Dentro de los propios *Enums.php y *Schema.php
- Comentarios y doc-blocks
- Strings en mensajes de log/error (no son valores de BD)
- Strings comunes que no son valores enum (ej: 'true', 'false', 'null', 'ok')

**Severidad:** Warning

**Mensaje:** `"'activo' deberia usar SamplesEnums::ESTADO_ACTIVO"`

#### 1.3 `[endpoint-accede-bd]` — Controller con queries directas (EXISTENTE, no implementado)

**Deteccion:** Si un archivo tiene nombre con `Controller`/`Endpoints` y contiene `$this->pg`,
`PostgresService`, `$wpdb->`, o `->ejecutar(` (metodo del PostgresService), reportar.

**Exclusion:** Archivos dentro de `Database/Repositories/`, BaseRepository, PostgresService.

**Severidad:** Warning

**Mensaje:** `"Query directa en controller. Mover logica de datos a un Repository."`

#### 1.4 `[interval-sin-whitelist]` — INTERVAL con variable sin validar (P0 seguridad)

**Problema detectado en auditorias:** `INTERVAL '$variable'` es string interpolado, no parametro PDO.
Vector de inyeccion SQL.

**Deteccion:** Regex `INTERVAL\s+['"]?\s*[\$\{]` o `INTERVAL\s+'\s*\$` en archivos PHP.

**Exclusion:** Si la variable se valida con whitelist en las 10 lineas anteriores
(`in_array`, `match`, `switch` con valores fijos).

**Severidad:** Error

#### 1.5 `[open-redirect]` — Redireccion con URL no validada (EXISTENTE, no implementado)

**Deteccion:** `wp_redirect($variable)` o `header('Location: ' . $variable)` sin
`wp_validate_redirect()` cercano.

**Severidad:** Error

#### 1.6 `[return-void-critico]` — Metodos de escritura con return void (EXISTENTE, no implementado)

**Deteccion:** Metodo PHP con `INSERT|UPDATE|DELETE|->insertar|->actualizar|->eliminar` en body
y signature `: void` o sin return type.

**Exclusion:** Metodos protected/private (solo reportar en API publica).

**Severidad:** Warning

---

### Sprint 2 — Rendimiento React/TS + Patrones Glory (Prioridad ALTA) ✅ COMPLETADO

> **Completado:** Sprint 2. 7 reglas nuevas implementadas:
> - reactAnalyzer.ts: zustand-objeto-selector, key-index-lista, componente-sin-hook-glory,
>   promise-sin-catch, useeffect-dep-inestable (5 funciones nuevas)
> - staticAnalyzer.ts: any-type-explicito (1 funcion nueva)
> - gloryAnalyzer.ts: isla-no-registrada con carga de appIslands.tsx + watcher (1 funcion nueva)
> Total: 43 reglas activas.

#### 2.1 `[zustand-objeto-selector]` — Selector que crea nuevo objeto/array (NUEVO)

**Problema:** `useStore(s => ({ a: s.a, b: s.b }))` crea referencia nueva en cada render,
causando re-renders infinitos. Zustand recomienda `useShallow` o selectores individuales.

**Deteccion:** Regex: `use\w*Store\s*\(\s*\w+\s*=>\s*\(\s*\{` (selector que retorna objeto literal)
o `use\w*Store\s*\(\s*\w+\s*=>\s*\[` (selector que retorna array literal).

**Severidad:** Warning

**Mensaje:** `"Selector Zustand crea nuevo objeto/array en cada render. Usar selectores individuales o useShallow()."`

#### 2.2 `[key-index-lista]` — key={index} en listas dinamicas (NUEVO)

**Problema:** `key={index}` o `key={i}` en map/forEach causa reconciliacion incorrecta
cuando items se agregan/eliminan/reordenan.

**Deteccion:** Regex dentro de `.map(` callback: `key=\{(index|i|idx|indice)\}`.

**Exclusion:** Listas estaticas (sin botones de delete/add/reorder cerca).
Para reducir falsos positivos, solo reportar si el componente tambien tiene
state mutations (useState/set) que sugieran dinamismo. O nivel: hint (no warning).

**Severidad:** Hint

#### 2.3 `[componente-sin-hook-glory]` — Componente con logica excesiva sin hook dedicado (MEJORAR)

**Problema existente:** `separacion-logica-vista` esta en PLAN_DETECCIONES pero no implementada.
Glory requiere estrictamente: componente.tsx (solo JSX) + useComponente.ts (logica).

**Deteccion estatica mejorada:**
1. Contar lineas entre primer `import` y `return (` o `return <` (JSX)
2. Dentro de esas lineas, contar: useEffect, useState, fetch, await, if/else, try-catch
3. Si >5 lineas de logica (excluyendo destructuring de hook y props), reportar

**Exclusion:** Archivos `use*.ts` (ya son hooks), archivos de test, archivos dentro de `_generated/`.

**Severidad:** Warning

#### 2.4 `[promise-sin-catch]` — Promise sin manejo de error (EXISTENTE en plan, no implementado)

**Deteccion:** `.then(` sin `.catch(` posterior en la misma cadena, y sin estar dentro de try-catch.

**Severidad:** Warning

#### 2.5 `[any-type-explicito]` — Tipo any explicito (EXISTENTE en plan, no implementado)

**Deteccion:** `: any` o `as any` en archivos TS/TSX (excluyendo `.d.ts` y comentarios).

**Severidad:** Hint

#### 2.6 `[isla-no-registrada]` — Isla creada pero no registrada en appIslands.tsx (NUEVO, Glory-especifico)

**Deteccion:**
1. Buscar archivos en `islands/` que exportan un componente
2. Verificar que ese nombre aparece en `appIslands.tsx`
3. Si no esta, reportar en el archivo de la isla

**Complejidad:** Media (requiere leer appIslands.tsx al activar).

**Severidad:** Warning

#### 2.7 `[useeffect-dep-inestable]` — useEffect con dependencia que cambia cada render (NUEVO)

**Deteccion heuristica:** useEffect con `[objeto]` o `[array]` o `[funcion]` como dep
donde esas variables se crean inline (no memoizadas).

**Complejidad:** Alta — requiere tracking de variables. Candidato para IA en vez de estatico.

**Severidad:** Hint (alta tasa de falsos positivos esperada)

---

### Sprint 3 — Arquitectura y Calidad General (Prioridad MEDIA) ✅ COMPLETADO

> **Completado:** Sprint 3. 6 reglas nuevas implementadas:
> - gloryAnalyzer.ts: n-plus-1-query, controller-fqn-inline, php-sin-return-type,
>   repository-sin-whitelist-columnas (4 funciones nuevas)
> - staticAnalyzer.ts: nomenclatura-css-ingles, css-hardcoded-value (2 funciones nuevas)
> - CSS habilitado como lenguaje por defecto + incluido en workspace scan.
> - diagnosticProvider.ts actualizado para llamar analizarGlory en TSX/JSX.
> Total final: 43 reglas activas.

#### 3.1 `[n-plus-1-query]` — Loop con query dentro (PHP) (EXISTENTE en plan)

**Deteccion:** `foreach`/`for`/`while` con `$this->pg->`, `$wpdb->`, `->ejecutar(`,
`->buscarPorId(` dentro del bloque.

**Exclusion:** Si hay cache explicito (`$cache`, `wp_cache_get`).

**Severidad:** Warning

#### 3.2 `[controller-fqn-inline]` — FQN inline en PHP (NUEVO)

**Problema del protocolo:** Usar `\App\Config\Schema\_generated\SamplesCols::TITULO` inline
en vez de `use` statement al inicio.

**Deteccion:** `\\App\\` o `\\Glory\\` dentro del cuerpo de un metodo (fuera de `use` statements).

**Severidad:** Hint

#### 3.3 `[php-sin-return-type]` — Funcion publica PHP sin return type (NUEVO)

**Deteccion:** `public function nombre(...)` sin `: tipo` antes de `{`.

**Exclusion:** Constructores, destructores. Metodos con `@return` en docblock (parcial).

**Severidad:** Hint

#### 3.4 `[nomenclatura-css-ingles]` — Clases CSS en ingles (EXISTENTE en plan)

**Deteccion:** Diccionario de palabras inglesas comunes en selectores CSS.
Regex: `\.(main|container|wrapper|button|header|footer|section|sidebar|content|nav|card|list|item)\b`

**Exclusion:** Archivos de librerias (node_modules, vendor, shadcn).

**Severidad:** Hint (solo informativo, muchos falsos positivos con librerias)

#### 3.5 `[repository-sin-whitelist-columnas]` — Query con SELECT * o sin whitelist (NUEVO)

**Problema:** Queries que hacen `SELECT *` en vez de listar columnas explicitas.
Ineficiente y rompe si se agregan columnas.

**Deteccion:** `SELECT\s+\*\s+FROM` en archivos PHP fuera de `_generated/`.

**Severidad:** Hint

#### 3.6 `[css-hardcoded-value]` — Valor CSS hardcodeado (colores, spacing) (MEJORAR existente)

**Actualmente:** Solo listada en rules.md como regla IA. No implementada en estatico.

**Deteccion:** En archivos CSS/SCSS: `#[0-9a-fA-F]{3,8}` o `rgb(` o `rgba(` o `hsl(`
fuera de archivos `variables.css`, `init.css`, `:root`.

**Exclusion:** Dentro de `var()`, archivos de librerias, color-mix().

**Severidad:** Warning

---

## Arquitectura de Implementacion

### Nuevo archivo: `gloryAnalyzer.ts`

Analyzer especializado para patrones del Glory framework. Complementa phpAnalyzer y reactAnalyzer.

**Responsabilidades:**
1. Cargar mapa de schemas al activar (lectura de `_generated/*Cols.php` y `*Enums.php`)
2. Detectar hardcoded columns/enums en archivos PHP
3. Detectar endpoint-accede-bd
4. Detectar isla-no-registrada (leyendo appIslands.tsx)

**Inicializacion:**
- Al activar la extension, escanear `App/Config/Schema/_generated/` por archivos Cols/Enums
- Parsear constantes con regex simple: `const\s+(\w+)\s*=\s*'([^']+)'`
- Construir Map<nombreColumna, { tabla, constanteFull, archivo }>
- Construir Map<valorEnum, { constanteFull, archivo }>
- Cache en memoria, invalidar con FileSystemWatcher si _generated/ cambia

### Modificaciones a archivos existentes

| Archivo               | Cambio                                              |
|-----------------------|------------------------------------------------------|
| `ruleRegistry.ts`     | Agregar IDs de nuevas reglas (~12 nuevas)            |
| `ruleCategories.ts`   | Nueva categoria `GloryFramework`                     |
| `types/index.ts`      | Agregar `CategoriaRegla.GloryFramework`              |
| `diagnosticProvider.ts` | Importar y ejecutar gloryAnalyzer                  |
| `reactAnalyzer.ts`    | Agregar 2.1 (zustand-objeto), 2.2 (key-index)       |
| `phpAnalyzer.ts`      | Agregar 1.4 (interval), 1.5 (redirect), 1.6 (void)  |
| `staticAnalyzer.ts`   | Agregar 2.5 (any-type) como regla regex              |

### Nuevas categorias

```typescript
GloryFramework = 'glory-framework',    /* Schema, repos, islas */
RendimientoReact = 'rendimiento-react', /* Performance patterns */
```

---

## Prioridad de Implementacion

| #  | Regla ID                   | Sprint | Impacto | Complejidad | Falsos Positivos |
|----|----------------------------|--------|---------|-------------|------------------|
| 1  | hardcoded-sql-column       | 1      | CRITICO | Media-alta  | Medio            |
| 2  | hardcoded-enum-value       | 1      | CRITICO | Media       | Medio            |
| 3  | interval-sin-whitelist     | 1      | CRITICO | Baja        | Bajo             |
| 4  | endpoint-accede-bd         | 1      | Alto    | Baja        | Bajo             |
| 5  | open-redirect              | 1      | Alto    | Baja        | Bajo             |
| 6  | return-void-critico        | 1      | Medio   | Media       | Medio            |
| 7  | zustand-objeto-selector    | 2      | Alto    | Baja        | Bajo             |
| 8  | componente-sin-hook-glory  | 2      | Alto    | Media       | Medio            |
| 9  | any-type-explicito         | 2      | Medio   | Baja        | Bajo             |
| 10 | key-index-lista            | 2      | Medio   | Baja        | Alto             |
| 11 | promise-sin-catch          | 2      | Medio   | Media       | Medio            |
| 12 | isla-no-registrada         | 2      | Medio   | Media       | Bajo             |
| 13 | n-plus-1-query             | 3      | Medio   | Media       | Medio            |
| 14 | controller-fqn-inline      | 3      | Bajo    | Baja        | Bajo             |
| 15 | php-sin-return-type        | 3      | Bajo    | Baja        | Medio            |
| 16 | css-hardcoded-value        | 3      | Medio   | Baja        | Alto             |
| 17 | repository-sin-whitelist   | 3      | Bajo    | Baja        | Medio            |
| 18 | nomenclatura-css-ingles    | 3      | Bajo    | Baja        | Alto             |

---

## Mejoras a Glory Framework (detectadas durante analisis)

1. **ConversacionesCols incompleto:** Falta `participante_1` y `participante_2`. Regenerar schema.
2. **BaseRepository ejemplos en comentarios usan strings:** L120, L145 usan `'estado' => 'activo'` en
   docblocks de ejemplo. Cambiar a constantes en la documentacion.
3. **Consistencia de patrones:** Repos como ComentariosRepository y PublicacionesRepository pasan
   `$estado` como variable pero no siempre usan Enums para construir ese valor. El caller puede
   pasar strings. Considerar type-hinting con Enums o whitelists en el repo.
4. **Aliases SQL:** El proyecto usa strings literales para SQL aliases (`as total_items`, `as otro_id`).
   Esto es aceptable (aliases no son columnas de tabla), pero la deteccion debe excluirlos.

---

## Notas de Implementacion

- Cada nueva regla DEBE registrarse en `ruleRegistry.ts` con categoria apropiada
- Cada nueva regla debe tener tests en la suite de mocha
- El gloryAnalyzer debe cachear el mapa de schemas en memoria (no releer cada analisis)
- Las reglas Glory solo aplican si `_generated/` existe en el workspace (no romper en proyectos no-Glory)
- Para reglas complejas (componente-sin-hook-glory, n-plus-1), considerar delegacion al aiAnalyzer
  si la heuristica estatica es demasiado imprecisa
- Nivel de falsos positivos bajo = implementar estatico. Alto = hint o IA.

---

## Metricas de Exito

- **Sprint 1:** Detectar >80% de strings hardcodeados que deberian usar Cols/Enums en archivos PHP
  del proyecto Kamples. 0 INTERVAL injection no detectados.
- **Sprint 2:** Reducir zustand re-renders detectados. Componentes sin hook separado tienen warning.
- **Sprint 3:** Reducir deuda tecnica acumulada con hints de calidad.

