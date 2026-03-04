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

## Resultados finales

### Fases completadas
- **Fase 1** (helpers compartidos): `analisisHelpers.ts` (56 líneas) con 6 helpers reutilizados en todos los módulos.
- **Fase 2** (split gloryAnalyzer): 1,460 → 106 líneas fachada + 4 submódulos.
  - gloryPhpRules.ts (688) → split adicional en 3: glorySchemaRules (215), glorySecurityRules (163), gloryQualityRules (213).
- **Fase 3** (split reactAnalyzer): 1,082 → 101 líneas fachada + 3 submódulos (reactHookRules 179, reactErrorRules 252, reactComponentRules 406).
- **Fase 4** (diagnosticProvider): 558 → 438 líneas + reportGenerator.ts (96). Eliminado esReglaIA() frágil, reemplazado con fuente-based tagging.
- **Fase 5** (extension.ts): Diferida — 264 líneas, bajo el límite.
- **Split phpAnalyzer**: 847 → 59 líneas fachada + 3 submódulos (phpControllerRules 155, phpDataRules 229, phpSecurityRules 298).
- **Split staticAnalyzer**: 610 → 189 líneas fachada + 2 submódulos (staticCodeRules 210, staticCssRules 130).
- **Hash dedup**: debounceService y cacheService usan calcularHash de analisisHelpers.

### Métricas

| Archivo | Antes | Después |
|---------|-------|---------|
| gloryAnalyzer.ts | 1,460 | 121 (fachada) |
| reactAnalyzer.ts | 1,082 | 101 (fachada) |
| phpAnalyzer.ts | 847 | 59 (fachada) |
| staticAnalyzer.ts | 610 | 189 (fachada) |
| diagnosticProvider.ts | 558 | 438 |
| **Archivo más grande** | **1,460** | **478 (aiAnalyzer)** |

### Tests: 174 passing, 6 pre-existentes failing (0 regresiones).
### Commits: 3 — [AG-REF] split monolitos, split phpAnalyzer, split gloryPhpRules+staticAnalyzer.

### Lecciones aprendidas
- [Compilación]: PowerShell here-strings (@'...'@) pierden caracteres especiales como `—`, usar Set-Content con encoding UTF8.
- [Tests]: `npm test` requiere VS Code no esté actualizándose. Alternativa: `npx mocha --require out/test/registerMocks.js --ui tdd --color --timeout 10000 "out/test/suite/**/*.test.js"`.
- [Tests pre-existentes fallidos]: lineCounter (2 — expectativas desactualizadas para hook/css limits), phpAnalyzer wpdb (2 — tests que no contemplan exclusiones contextuales), css-inline-jsx (2 — regla eliminada pero tests no removidos).
- [Arquitectura]: Las fachadas delgadas (importar + despachar) son el patrón correcto para mantener el API pública sin romper consumidores.
- [esReglaIA]: El heurístico de lista hardcodeada se reemplazó con campo `fuente` en cada Violacion — escalable sin mantenimiento.
- [phpAnalyzer.verificarArchivosTemporalesSinFinally]: El parámetro `texto` era dead code — solo usaba `lineas`. Eliminado en el split.
