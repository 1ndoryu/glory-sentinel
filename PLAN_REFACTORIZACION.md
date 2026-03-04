# Plan de Refactorización — Code Sentinel

## Estado actual: 30 archivos .ts, ~8,000 líneas

---

## Problemas detectados

### P1. God Object: gloryAnalyzer.ts (1,460 líneas)
Mezcla responsabilidades no relacionadas:
- **Carga de schema** (parseo de Cols/Enums desde archivos PHP generados)
- **Carga de islas** (parseo de appIslands.tsx y inicializarIslands.ts)
- **Reglas SQL** (hardcodedSqlColumn, hardcodedEnumValue, selectStar, nPlus1Query)
- **Reglas de seguridad** (openRedirect, intervalSinWhitelist)
- **Reglas de tipos** (phpSinReturnType, returnVoidCritico, fqnInline)
- **Reglas DefaultContent** (6 funciones copy-paste para meta/slug/titulo/imagen/galeria/contenido)
- **Regla islas** (islaNoRegistrada)

### P2. God Object: reactAnalyzer.ts (1,082 líneas)
15 funciones de reglas organizadas por sprints. Cada una repite:
- Exclusión `!rutaNormalizada.includes('/Glory/')` (15+ veces)
- Spliteo a líneas y bucle con skip de comentarios
- Push de violación con boilerplate idéntico

### P3. Boilerplate duplicado en todas las reglas
Patrón repetido en ~30 funciones:
```ts
const trim = lineas[i].trim();
if (trim.startsWith('//') || trim.startsWith('*') || ...) continue;
if (lineas[i-1]?.includes('sentinel-disable-next-line regla-id')) continue;
```

### P4. diagnosticProvider.ts (558 líneas) — demasiadas responsabilidades
- Orquestación de análisis
- Creación de diagnósticos
- Event handlers del editor
- Generación de reporte markdown
- Escaneo completo del workspace

### P5. esReglaIA() — heurístico frágil
Lista hardcodeada de IDs para distinguir diagnósticos IA vs estáticos.
Se rompe cada vez que se agrega una regla nueva.

### P6. extension.ts contiene HTML
`mostrarResumenReglas()` genera HTML del webview inline (50+ líneas de template strings).

### P7. Sprint 6 DefaultContent rules — copy-paste
6 funciones casi idénticas que solo cambian el nombre de clave y el regex.
Deben ser UNA función parametrizada.

### P8. Hash MD5 duplicado
`calcularHash()` está implementado dos veces: en `debounceService.ts` y `cacheService.ts`.

---

## Plan de ejecución

### Fase 1: Helpers compartidos
1. Crear `src/utils/analisisHelpers.ts` con:
   - `esComentario(linea)` — reemplaza todas las variantes de skip de comentarios
   - `tieneSentinelDisable(lineas, indice, reglaId)` — reemplaza checks manuales
   - `esRutaGlory(ruta)` — reemplaza `!ruta.includes('/Glory/')`
   - `calcularHash(contenido)` — elimina duplicación
   - `obtenerLineas(documento)` — helper para doc.getText().split('\n')

### Fase 2: Split gloryAnalyzer.ts → 4 módulos
1. `src/analyzers/glory/schemaLoader.ts` (~130 líneas)
   - buscarCarpetaGenerated, parsearArchivoCols, parsearArchivoEnums
   - cargarSchema, inicializarGloryAnalyzer (watchers de schema)

2. `src/analyzers/glory/islandTracker.ts` (~150 líneas)
   - Carga de islas desde appIslands.tsx e inicializarIslands.ts
   - parsearIslasDeContenido, watchers de islas
   - verificarIslaNoRegistrada

3. `src/analyzers/glory/gloryPhpRules.ts` (~500 líneas)
   - hardcodedSqlColumn, hardcodedEnumValue, endpointAccedeBd
   - intervalSinWhitelist, openRedirect, returnVoidCritico
   - nPlus1Query, fqnInline, phpSinReturnType, selectStar

4. `src/analyzers/glory/defaultContentRules.ts` (~80 líneas)
   - UNA función genérica `verificarDefaultContentClave(lineas, config)` parametrizada
   - Array de configuraciones (meta→metaEntrada, slug→slugDefault, etc.)
   - Reemplaza las 6 funciones copy-paste

5. `src/analyzers/gloryAnalyzer.ts` → fachada (~60 líneas)
   - Re-exporta `analizarGlory()` e `inicializarGloryAnalyzer()`
   - Importa de los 4 submódulos y despacha

### Fase 3: Limpiar reactAnalyzer.ts
1. Extraer la exclusión Glory/ al caller (diagnosticProvider) o al helper
2. Usar helpers `esComentario` y `tieneSentinelDisable` para reducir boilerplate
3. No splitear en submódulos (es cohesivo, solo necesita reducir duplicación)

### Fase 4: Refactorizar diagnosticProvider.ts
1. Extraer `src/providers/reportGenerator.ts` (~120 líneas)
   - generarReporteWorkspace, severidadTexto
2. Eliminar `esReglaIA()` — cada Violacion ya tiene campo `fuente: 'estatico' | 'ia'`
   - Al crear diagnósticos, marcar con metadata `fuente` en el código del diagnóstico
   - Al hacer merge, filtrar por fuente real, no por heurístico

### Fase 5: Limpiar extension.ts
1. Extraer `src/providers/webviewProvider.ts` para el HTML de mostrarResumenReglas()

### Fase 6: Compilar, testear, instalar
1. `npm run compile` — verificar 0 errores
2. `npm test` — verificar que los tests existentes pasan
3. `npx vsce package --no-dependencies -o glory-sentinel.vsix`
4. `code --install-extension glory-sentinel.vsix --force`

---

## Métricas objetivo

| Archivo | Antes | Después |
|---------|-------|---------|
| gloryAnalyzer.ts | 1,460 | ~60 (fachada) |
| glory/schemaLoader.ts | - | ~130 |
| glory/islandTracker.ts | - | ~150 |
| glory/gloryPhpRules.ts | - | ~500 |
| glory/defaultContentRules.ts | - | ~80 |
| reactAnalyzer.ts | 1,082 | ~900 (reducción boilerplate) |
| diagnosticProvider.ts | 558 | ~400 |
| reportGenerator.ts | - | ~120 |
| utils/analisisHelpers.ts | - | ~60 |

Ningún archivo >600 líneas después de la refactorización.
