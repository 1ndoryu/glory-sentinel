t# Code Sentinel - Extension VS Code para Enforcement de Reglas de Protocolo

## Descripcion General

Extension de VS Code que analiza automaticamente el codigo contra un conjunto de reglas de protocolo de desarrollo definidas por el usuario. Combina analisis estatico (regex/AST) para deteccion instantanea con analisis semantico (IA via `vscode.lm` API con GPT-4o-mini gratuito) para violaciones complejas. Genera diagnosticos nativos de VS Code (panel Problems) sin modificar archivos.

---

## Objetivo

Automatizar la deteccion de violaciones recurrentes del protocolo de desarrollo (actualmente documentado en `.github/instructions/test.instructions.md`) para que los agentes IA y los desarrolladores reciban feedback inmediato sin depender de revision manual.

---

## Modelo de IA

- **Modelo primario:** GPT-5 mini (gratuito con GitHub Copilot Premium)
- **API:** `vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o-mini' })`
- **Fallback:** Si el modelo no esta disponible, la extension funciona solo con reglas estaticas (Nivel 1)


---

## Arquitectura

```
code-sentinel/
  .vscode/
    launch.json                  # Configuracion de debugging
  src/
    extension.ts                 # Punto de entrada, registro de providers y eventos
    config/
      defaultRules.ts            # Reglas estaticas por defecto (regex + metadata)
      ruleCategories.ts          # Categorias y severidades de reglas
      prompts.ts                 # Prompts de IA organizados por tipo de archivo
    providers/
      diagnosticProvider.ts      # Coordina analisis y genera Diagnostics
      codeActionProvider.ts      # Quick-fixes para violaciones comunes
    analyzers/
      staticAnalyzer.ts          # Motor de reglas estaticas (regex/conteo)
      aiAnalyzer.ts              # Motor de analisis con IA via vscode.lm
      phpAnalyzer.ts             # Reglas especificas PHP/WordPress
      reactAnalyzer.ts           # Reglas especificas React/TypeScript
      cssAnalyzer.ts             # Reglas especificas CSS
    services/
      debounceService.ts         # Control de timing/cooldown de analisis
      ruleLoader.ts              # Carga reglas desde archivo .md del usuario
      cacheService.ts            # Cache de resultados por archivo+hash
    types/
      index.ts                   # Tipos TypeScript de la extension
    utils/
      lineCounter.ts             # Conteo de lineas excluyendo comentarios
      regexPatterns.ts           # Patrones regex reutilizables
  test/
    suite/
      staticAnalyzer.test.ts
      debounceService.test.ts
      extension.test.ts
  package.json
  tsconfig.json
  .eslintrc.json
  .gitignore
  .vscodeignore
  README.md
  CHANGELOG.md
  icon.png
```

---

## Funcionalidades

### Nivel 1 - Analisis Estatico (instantaneo, sin IA)

Reglas detectables con regex y conteo. Se ejecutan inmediatamente al abrir/editar un archivo.

#### 1.1 Limites de archivo (Seccion 3 del protocolo)

| Regla | Deteccion | Severidad |
|-------|-----------|-----------|
| Componente/Estilo > 300 lineas | Conteo excluyendo comentarios y lineas vacias | Warning |
| Hook > 120 lineas | Idem, en archivos `use*.ts` | Warning |
| Utils > 150 lineas | Idem, en archivos dentro de `utils/` | Warning |

**Implementacion:**
```typescript
/* Cuenta lineas efectivas excluyendo comentarios y lineas vacias */
function contarLineasEfectivas(texto: string): number {
  const lineas = texto.split('\n');
  let enComentarioBloque = false;
  let cuenta = 0;
  for (const linea of lineas) {
    const trimmed = linea.trim();
    if (trimmed.startsWith('/*')) enComentarioBloque = true;
    if (enComentarioBloque) {
      if (trimmed.includes('*/')) enComentarioBloque = false;
      continue;
    }
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    cuenta++;
  }
  return cuenta;
}
```

#### 1.2 Patrones prohibidos (Seccion 7)

| Patron | Regex | Aplica a | Severidad |
|--------|-------|----------|-----------|
| Supresor `@` en PHP | `/@(unlink\|file_get_contents\|fopen\|mkdir\|rmdir\|copy\|rename\|readfile\|glob)\s*\(` | `.php` | Error |
| SQL sin prepare | `\$wpdb->(query\|get_var\|get_results\|get_row\|get_col)\s*\(\s*[^)]*(?<!\bprepare\b)` (heuristico) | `.php` | Error |
| `eval()` | `\beval\s*\(` | `.php`, `.ts`, `.tsx`, `.js` | Error |
| `innerHTML` con variable | `\.innerHTML\s*=\s*[^'"$]` | `.ts`, `.tsx`, `.js` | Warning |
| CSS inline en JSX | `style\s*=\s*\{\{` | `.tsx`, `.jsx` | Warning |
| `git add .` / `git add --all` | `git\s+add\s+(\.\|--all)` | `.sh`, `.ps1`, `.md` | Warning |
| `console.log` generico en catch | `catch.*\{[\s\S]*?console\.(log\|warn)\s*\(` (heuristico) | `.ts`, `.tsx`, `.js` | Warning |
| Catch vacio | `catch\s*\([^)]*\)\s*\{\s*\}` | Todos | Error |
| `@unlink`, `@file_get_contents`, etc. | `/@\w+\(` | `.php` | Error |
| Hardcoded password/secret | `(password\|secret\|api_key\|token)\s*=\s*['"][^'"]+['"]` | Todos | Error |

#### 1.3 Estructura y nomenclatura (Secciones 2, 4, 5)

| Regla | Deteccion | Severidad |
|-------|-----------|-----------|
| Mas de 3 `useState` en componente | Contar `useState` en `.tsx`/`.jsx` | Warning |
| Clase CSS en ingles (heuristico) | Diccionario de palabras comunes inglesas en nombres de clase | Info |
| Barras decorativas en comentarios | `/[=]{4,}/` o `/[-]{4,}/` | Info |
| Import muerto (parcial) | Import sin uso en el archivo (regex simplificado) | Warning |

#### 1.4 WordPress/PHP especificos

| Regla | Deteccion | Severidad |
|-------|-----------|-----------|
| `$wpdb->prepare()` faltante | `$wpdb->(query\|get_var\|get_results)\(` sin `prepare` | Error |
| Controller sin try-catch global | Metodo publico sin `try {` como primera instruccion | Warning |
| `$request->get_json_params()` pasado directo | `get_json_params()` sin filtrado posterior | Warning |

### Nivel 2 - Analisis con IA (debounced)

Reglas que requieren comprension semantica. Se ejecutan con cooldown controlado.

#### 2.1 Reglas semanticas

| Regla | Prompt resumido | Aplica a |
|-------|----------------|----------|
| Separacion logica-vista | "Tiene este componente mas de 5 lineas de logica mezclada con JSX?" | `.tsx` |
| SRP violado | "Tiene este archivo mas de una responsabilidad clara?" | Todos |
| Try-catch faltante en operaciones I/O | "Hay operaciones de I/O, red o BD sin proteccion try-catch?" | `.php`, `.ts` |
| Endpoint accediendo a BD directamente | "Este controller tiene queries $wpdb directas?" | `.php` |
| Error enmascarado como exito | "Hay catches que retornan ok:true o datos vacios en vez de error?" | `.ts`, `.tsx` |
| Inmutabilidad violada | "Hay mutaciones directas de estado React (splice, push, asignacion directa)?" | `.tsx` |
| Update optimista sin rollback | "Hay updates optimistas del UI sin verificacion posterior de resp.ok?" | `.tsx` |
| useEffect sin cleanup | "Hay useEffects con async/fetch sin AbortController en cleanup?" | `.tsx` |

#### 2.2 Segmentacion de prompts por tipo de archivo

Para optimizar tokens, solo se envian las reglas relevantes al tipo de archivo:

```typescript
const reglasporTipo: Record<string, string[]> = {
  php: ['sql-security', 'try-catch', 'controller-pattern', 'sanitization', 'wpdb-prepare'],
  tsx: ['srp', 'logic-view-separation', 'immutability', 'zustand-selectors', 'useEffect-cleanup'],
  css: ['variables-obligatorias', 'nomenclatura-espanol', 'no-hardcoded-values'],
  general: ['file-limits', 'comments-quality', 'dead-imports']
};
```

#### 2.3 Formato de prompt para la IA

```
Eres un auditor de codigo. Analiza el siguiente archivo contra estas reglas especificas.
Responde SOLO en JSON con este formato exacto:

{
  "violaciones": [
    {
      "linea": 42,
      "lineaFin": 45,
      "regla": "try-catch-faltante",
      "severidad": "error",
      "mensaje": "file_get_contents() en linea 42 no esta protegido con try-catch",
      "sugerencia": "Envolver en try-catch con logging del error"
    }
  ]
}

Si no hay violaciones, responde: {"violaciones": []}

REGLAS A VERIFICAR:
[reglas segmentadas segun tipo de archivo]

CODIGO:
[contenido del archivo]
```

---

## Sistema de Timing/Debounce

### Logica de cooldown

```
ESTADO INICIAL (archivo abierto):
  - Check estatico: INMEDIATO
  - Check IA: programado en T=60s

AL EDITAR:
  - Check estatico: INMEDIATO (debounce 500ms para no saturar durante typing rapido)
  - Check IA: reset timer a T=30s desde ultima edicion

COOLDOWN POST-IA:
  - Despues de un check IA exitoso: cooldown de 5 minutos para el mismo archivo (a menos que se edite)
  - Si el archivo no cambia (hash identico): no re-analizar

LIMITES GLOBALES:
  - Max 1 request IA simultaneo (cola FIFO si hay multiples archivos pendientes)
  - Max 10 requests IA por minuto (rate limit safety)
  - Si el modelo no responde en 15s: timeout y solo mostrar resultados estaticos
```

### Implementacion del debounce

```typescript
interface EstadoArchivo {
  hash: string;
  ultimoAnalisisEstatico: number;
  ultimoAnalisisIA: number;
  timerIA: NodeJS.Timeout | null;
  resultadosCache: Diagnostico[];
}

const estadoArchivos = new Map<string, EstadoArchivo>();

function programarAnalisisIA(uri: vscode.Uri): void {
  const estado = estadoArchivos.get(uri.toString());
  if (estado?.timerIA) clearTimeout(estado.timerIA);

  const nuevoTimer = setTimeout(async () => {
    const hashActual = calcularHash(uri);
    if (estado && estado.hash === hashActual && estado.ultimoAnalisisIA > 0) {
      return; /* Sin cambios desde ultimo analisis */
    }
    await ejecutarAnalisisIA(uri);
  }, 30_000);

  actualizarEstado(uri, { timerIA: nuevoTimer });
}
```

---

## Configuracion del usuario (settings.json)

```jsonc
{
  /* Habilitar/deshabilitar niveles de analisis */
  "codeSentinel.staticAnalysis.enabled": true,
  "codeSentinel.aiAnalysis.enabled": true,

  /* Modelo de IA a usar */
  "codeSentinel.ai.modelFamily": "gpt-4o-mini",

  /* Timing */
  "codeSentinel.timing.staticDebounceMs": 500,
  "codeSentinel.timing.aiDelayOnOpenMs": 60000,
  "codeSentinel.timing.aiDelayOnEditMs": 30000,
  "codeSentinel.timing.aiCooldownMs": 300000,
  "codeSentinel.timing.aiTimeoutMs": 15000,

  /* Limites */
  "codeSentinel.limits.maxAiRequestsPerMinute": 10,
  "codeSentinel.limits.maxFileSizeForAiKb": 100,

  /* Archivo de reglas personalizadas (path relativo al workspace) */
  "codeSentinel.rulesFile": ".github/instructions/test.instructions.md",

  /* Severidades personalizables */
  "codeSentinel.severity.fileLimit": "warning",
  "codeSentinel.severity.suppressorAt": "error",
  "codeSentinel.severity.sqlWithoutPrepare": "error",
  "codeSentinel.severity.cssInline": "warning",

  /* Exclusiones */
  "codeSentinel.exclude": [
    "**/node_modules/**",
    "**/vendor/**",
    "**/dist/**",
    "**/_generated/**"
  ],

  /* Idiomas de archivo donde se activa */
  "codeSentinel.languages": [
    "php", "typescript", "typescriptreact",
    "javascript", "javascriptreact", "css"
  ]
}
```

---

## Comandos de la Extension

| Comando | Titulo | Descripcion |
|---------|--------|-------------|
| `codeSentinel.analyzeFile` | Code Sentinel: Analizar Archivo Actual | Fuerza analisis completo (estatico + IA) del archivo activo |
| `codeSentinel.analyzeWorkspace` | Code Sentinel: Analizar Workspace | Escanea todos los archivos del workspace (solo estatico) |
| `codeSentinel.clearDiagnostics` | Code Sentinel: Limpiar Diagnosticos | Limpia todos los diagnosticos generados |
| `codeSentinel.toggleAI` | Code Sentinel: Activar/Desactivar IA | Toggle rapido del analisis IA |
| `codeSentinel.showRulesSummary` | Code Sentinel: Ver Resumen de Reglas | Muestra las reglas activas en un panel |
| `codeSentinel.dismissRule` | Code Sentinel: Ignorar Regla en Linea | Agrega comentario `/* sentinel-disable-next-line regla */` |

---

## Quick Fixes (CodeActionProvider)

Cuando un diagnostico tiene fix disponible, ofrecer correccion automatica:

| Violacion | Quick Fix |
|-----------|-----------|
| `@unlink()` | Reemplazar con `try { unlink(...) } catch (\Throwable $e) { ... }` |
| Catch vacio | Insertar `error_log($e->getMessage());` dentro del catch |
| CSS inline `style={{}}` | Crear clase CSS y referenciarla |
| `useState` > 3 | Extraer a hook personalizado (scaffold basico) |
| Archivo > 300 lineas | Marcar con `/* TO-DO: dividir archivo - excede 300 lineas */` |
| Import muerto | Eliminar la linea del import |

---

## Flujo de Eventos (Lifecycle)

```
ACTIVACION:
  extension.activate()
    -> Registrar DiagnosticCollection
    -> Registrar CodeActionProvider
    -> Cargar reglas desde archivo .md del usuario
    -> Indexar archivos existentes (hashes)
    -> Registrar listeners:
        onDidOpenTextDocument -> analisisEstatico() + programarIA()
        onDidChangeTextDocument -> analisisEstatico(debounce) + reprogramarIA()
        onDidCloseTextDocument -> limpiarEstado()
        onDidChangeConfiguration -> recargarConfig()

ANALISIS ESTATICO (sincrono, <50ms):
  1. Verificar extension del archivo contra lenguajes habilitados
  2. Verificar exclusiones (node_modules, vendor, etc.)
  3. Ejecutar reglas estaticas aplicables al tipo de archivo
  4. Generar Diagnostics con severity, rango, mensaje, codigo de regla
  5. Publicar en DiagnosticCollection

ANALISIS IA (asincrono, debounced):
  1. Verificar que IA esta habilitada y modelo disponible
  2. Verificar que archivo no excede tamano maximo
  3. Verificar cooldown (no re-analizar si hash no cambio)
  4. Seleccionar reglas relevantes al tipo de archivo
  5. Construir prompt con reglas + codigo
  6. Enviar a vscode.lm con timeout
  7. Parsear respuesta JSON
  8. Validar estructura de violaciones (lineas dentro de rango, etc.)
  9. Merge con diagnosticos estaticos existentes (sin duplicar)
  10. Publicar en DiagnosticCollection
```

---

## Fases de Desarrollo

### Fase 1 - Scaffolding y motor estatico

- [x] Inicializar proyecto (TypeScript, package.json, tsconfig.json)
- [x] Configurar tsconfig, .vscodeignore, launch.json
- [x] Implementar `extension.ts` con activacion basica
- [x] Implementar `staticAnalyzer.ts` con 13 reglas regex
- [x] Implementar `diagnosticProvider.ts` para publicar diagnosticos
- [x] Implementar `debounceService.ts` para timing de analisis estatico
- [x] Implementar configuracion completa en package.json (`contributes.configuration`)

### Fase 2 - Reglas estaticas completas

- [x] Implementar todas las reglas PHP de la tabla 1.2 y 1.4
- [x] Implementar todas las reglas React/TS de la tabla 1.2 y 1.3
- [x] Implementar reglas CSS de la tabla 1.3
- [x] Implementar `lineCounter.ts` para limites de archivo
- [x] Implementar sistema de exclusiones (glob matching) en `ruleLoader.ts`
- [x] Implementar `phpAnalyzer.ts`, `reactAnalyzer.ts`, `cssAnalyzer.ts`
- [x] Tests unitarios para lineCounter y regex patterns
- [x] Refinar regex para reducir false positives

### Fase 3 - Integracion con IA

- [x] Implementar `aiAnalyzer.ts` con `vscode.lm.selectChatModels()`
- [x] Implementar prompts segmentados por tipo de archivo (`prompts.ts`)
- [x] Implementar parser de respuesta JSON de la IA (con fallback si formato invalido)
- [x] Implementar cooldown y rate limiting en `debounceService.ts`
- [x] Implementar cache por hash de archivo (`cacheService.ts`)
- [x] Implementar merge de diagnosticos estaticos + IA sin duplicados
- [x] Manejar errores de modelo no disponible (graceful degradation)

### Fase 4 - Quick fixes y UX

- [x] Implementar `codeActionProvider.ts` con 5 tipos de fixes
- [x] Implementar comando `analyzeFile` (forzar analisis)
- [x] Implementar comando `analyzeWorkspace` (scan completo estatico)
- [x] Implementar comando `toggleAI` (toggle rapido)
- [x] Implementar comando `showRulesSummary` (panel webview)
- [x] Implementar supresion inline con `sentinel-disable-next-line`

### Fase 5 - Carga de reglas del usuario

- [x] Implementar `ruleLoader.ts` con carga de configuracion
- [x] Verificacion de existencia del archivo de reglas
- [ ] Hot-reload: detectar cambios en el archivo de reglas y recargar (futuro)
- [ ] Parsear reglas custom desde markdown del usuario (futuro)

### Fase 6 - Pulido y publicacion

- [x] Escribir README.md con documentacion completa
- [x] Crear CHANGELOG.md
- [x] Tests unitarios sin VS Code: sistema de mock de vscode + mocha directo (`npm run test:unit`)
- [x] Ampliar suite de tests: `ruleLoader.test.ts` (18 casos), `regexPatterns.test.ts` (55 casos)
- [x] Corregir bug `INNERHTML_VARIABLE`: backtracking de `\s*` eludia lookahead negativa → reemplazado por clase negada `[^'"\`\s]`
- [x] Corregir bug `GIT_ADD_ALL`: `\b` falla con '.' al final de cadena en JS → reemplazado por `(?=\s|$)`
- [ ] Crear icono de la extension (pendiente)
- [ ] Tests de integracion con @vscode/test-electron (pendiente, requiere descarga VS Code ~171MB)
- [ ] Empaquetar con `vsce package` (pendiente)
- [ ] Publicar en VS Code Marketplace (pendiente)

### Lecciones aprendidas

- [Tests]: `@vscode/test-electron` descarga VS Code completo (~171MB) en cada CI limpio; para tests unitarios de logica pura usar `npm run test:unit` que ejecuta mocha directo (49ms vs minutos)
- [Tests]: Mockear 'vscode' via `Module._resolveFilename` interceptor en `registerMocks.ts` permite testear modulos que `import * as vscode` sin instancia real
- [Regex]: `\.innerHTML\s*=\s*(?!['"\`])` es buggy por backtracking: `\s*` puede retroceder poniendo la lookahead ante el espacio (no ante la comilla). Fix: usar clase negada `[^'"\`\s]` que consume el caracter y no permite backtracking
- [Regex]: `\b` en JS no reconoce '.' como word character, entonces '\b' despues de '\.' al final de string no es boundary. Fix: usar `(?=\s|$)` para forzar limite de "fin de argumento"
- [Mocha]: Con `.mocharc.json` en la raiz, `npx mocha` usa esa config automaticamente; el `spec` pattern glob debe usar comillas en PowerShell

---

## Dependencias

```json
{
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0",
    "eslint": "^8.50.0",
    "@vscode/vsce": "^2.22.0"
  }
}
```

Sin dependencias externas de runtime. Todo se resuelve con APIs nativas de VS Code y Node.js.

---

## Consideraciones Tecnicas

### Rate limits de vscode.lm
- El API `vscode.lm` tiene limites no documentados oficialmente que varian segun el plan de Copilot
- Implementar backoff exponencial si se reciben errores 429
- Nunca enviar mas de 1 request simultaneo al modelo
- Cache agresivo: si el archivo no cambio (hash identico), no re-analizar

### Tamano del contexto
- Las reglas del protocolo completas son ~8K tokens
- Un archivo grande puede ser 2-5K tokens mas
- GPT-4o-mini tiene 128K de contexto, suficiente
- Aun asi, segmentar reglas por tipo de archivo reduce ruido y mejora precision

### False positives
- Las reglas regex por naturaleza generan falsos positivos
- Implementar sistema de `sentinel-disable-next-line` para supresion inline
- Implementar exclusiones globales por patron de archivo
- La IA reduce false positives pero introduce posibilidad de respuestas mal formateadas
- Siempre validar que las lineas reportadas por la IA existen en el archivo

### Performance
- El analisis estatico debe completarse en <50ms para no afectar la experiencia de edicion
- Compilar todas las regex una sola vez al activar la extension (no en cada analisis)
- No analizar archivos mayores a 100KB con IA (configurable)
- No analizar archivos en exclusiones (node_modules, vendor, dist, _generated)

---

## Mecanismo de Supresion Inline

Para evitar que diagnosticos persistentes molesten en casos donde la violacion es intencional:

```php
/* sentinel-disable-next-line sql-without-prepare */
$wpdb->query("SHOW TABLES");

/* sentinel-disable try-catch-required */
// ... bloque completo sin try-catch (justificado)
/* sentinel-enable try-catch-required */
```

```tsx
{/* sentinel-disable-next-line css-inline */}
<div style={{ position: 'absolute' }}>...</div>
```

La extension detectara estos comentarios y excluira la linea/bloque del diagnostico.

---

## Ejemplo de Salida en Panel Problems

```
archivo.php
  Error   [CS001] @unlink() detectado en linea 42. Usar try { unlink() } catch en su lugar. (sentinel:php-at-suppressor)
  Error   [CS002] $wpdb->query() sin $wpdb->prepare() en linea 78. (sentinel:sql-without-prepare)
  Warning [CS003] Archivo excede 300 lineas efectivas (342). Considerar dividir. (sentinel:file-limit)
  Warning [CS004] Metodo publico sin try-catch global en linea 15. (sentinel:controller-try-catch)

componente.tsx
  Warning [CS010] 5 useState detectados. Extraer logica a hook personalizado. (sentinel:max-usestate)
  Warning [CS011] CSS inline detectado en linea 28. Usar clase CSS separada. (sentinel:css-inline)
  Info    [CS012] Componente tiene >5 lineas de logica mezclada con JSX. (sentinel:logic-view-separation) [IA]
```

---

## Integracion con VarSense

Code Sentinel es complementario a VarSense (la extension existente de variables CSS). No hay solapamiento:
- VarSense: valida existencia y uso correcto de variables CSS
- Code Sentinel: valida patrones de codigo, arquitectura, seguridad y buenas practicas

Ambas generan diagnosticos en el mismo panel Problems sin conflicto.

---

## Lecciones Aprendidas de VarSense

- [Build]: Usar `tsc` directo es suficiente, no necesita bundler para extensiones VS Code
- [Publish]: `vsce package` genera el .vsix para instalar manualmente
- [API]: `vscode.languages.createDiagnosticCollection()` es la forma correcta de generar diagnosticos
- [Activation]: Usar `onLanguage:*` en `activationEvents` para activacion lazy
- [Testing]: `@vscode/test-electron` para tests de integracion con VS Code real
