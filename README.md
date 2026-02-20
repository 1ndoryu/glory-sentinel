# Glory Sentinel

![Portada Glory Sentinel](media/7599515f2b8981a49a057e0e9a75b8b6.jpg)

Glory Sentinel es una extensión de VS Code para auditoría continua de calidad de código.
Combina reglas estáticas instantáneas con análisis IA para detectar problemas reales de arquitectura, seguridad y mantenimiento.

## ¿Qué resuelve?

- Detecta violaciones de seguridad y robustez antes de que lleguen a producción.
- Señala deuda técnica estructural (archivos monolito, SRP, malas prácticas recurrentes).
- Aporta feedback rápido mientras editas, sin depender de una revisión manual completa.

## Capacidades

### 1) Análisis estático en tiempo real

- Límites de tamaño por tipo de archivo (componentes, hooks, utils).
- Patrones prohibidos (`eval`, supresores `@`, catches vacíos, secretos hardcodeados).
- SQL seguro: detecta `$wpdb->query/get_var/get_row/get_results` sin `prepare()`, con lógica contextual que excluye transacciones, DDL, `prepare()` anidado como argumento y queries sin parámetros de usuario.
- Ejecución de procesos: detecta `exec()`/`shell_exec()` sin `escapeshellarg()`, excluyendo `proc_open()` con array (seguro por diseño en PHP 7.4+).
- Reglas React/TS (mutación directa de estado, efectos sin cleanup, exceso de `useState`).
- Reglas PHP/WordPress (controllers sin try-catch, `json_decode` inseguro, inputs sin filtrar, `curl_exec` sin verificación, archivos temporales sin `finally`).

### 2) Análisis IA contextual

- Detección de violaciones semánticas que un regex no puede capturar.
- Revisión de separación lógica/vista y responsabilidades por componente.
- Detección de errores enmascarados y flujos inconsistentes entre UI y backend.

### 3) Reporte de workspace

Al ejecutar "Analizar Workspace", se genera automáticamente un archivo `.sentinel-report.md` con:
- Conteo de violaciones por severidad (error / warning / info / hint).
- Tabla por archivo con línea, regla y mensaje, ordenada por gravedad.
- Configurable via `codeSentinel.reportPath`.

## Archivos excluidos del análisis

Por defecto se excluyen automáticamente:

- `**/node_modules/**`
- `**/vendor/**`
- `**/dist/**`, `**/out/**`, `**/build/**`
- `**/_generated/**`
- `**/.vitepress/cache/**`
- `**/.agent/code-sentinel/**`

Puedes añadir exclusiones adicionales con `codeSentinel.exclude`.

## Comandos disponibles

| Comando | Descripción |
|---------|-------------|
| `Glory Sentinel: Analizar Archivo Actual` | Fuerza análisis completo del archivo activo |
| `Glory Sentinel: Analizar Workspace` | Escanea el workspace y genera reporte |
| `Glory Sentinel: Limpiar Diagnosticos` | Limpia todos los diagnósticos |
| `Glory Sentinel: Activar/Desactivar IA` | Enciende o apaga el análisis IA |
| `Glory Sentinel: Ver Resumen de Reglas` | Muestra reglas activas con estado habilitada/deshabilitada |

## Configuración recomendada

```json
{
  "codeSentinel.staticAnalysis.enabled": true,
  "codeSentinel.aiAnalysis.enabled": true,
  "codeSentinel.ai.backend": "gemini-cli",
  "codeSentinel.ai.geminiModel": "flash-min",
  "codeSentinel.timing.staticDebounce": 1,
  "codeSentinel.timing.aiDelayOnOpen": 5,
  "codeSentinel.timing.aiDelayOnEdit": 30,
  "codeSentinel.timing.aiCooldown": 300,
  "codeSentinel.timing.aiTimeout": 45,
  "codeSentinel.reportPath": ".sentinel-report.md"
}
```

> Todos los valores de timing están en **segundos**.

## Configurar reglas por ID

Puedes deshabilitar reglas individualmente o cambiar su severidad:

```json
{
  "codeSentinel.rules": {
    "barras-decorativas": { "habilitada": false },
    "catch-vacio": { "severidad": "warning" },
    "hardcoded-secret": { "severidad": "error" }
  }
}
```

### IDs de reglas disponibles

#### Patrones prohibidos (PHP / JS / TS)

| ID | Descripción | Aplica a | Default |
|----|-------------|----------|---------|
| `php-supresor-at` | Supresor `@` en funciones PHP (`@unlink`, `@copy`, etc.) | `.php` | error |
| `at-generico-php` | Supresor `@` en cualquier llamada PHP | `.php` | warning |
| `eval-prohibido` | `eval()` prohibido | PHP, JS, TS | error |
| `innerhtml-variable` | `innerHTML` asignado con variable (riesgo XSS) | JS, TS | warning |
| `catch-vacio` | Catch vacío sin logging ni propagación | PHP, JS, TS | error |
| `hardcoded-secret` | Password, API key o token en código fuente | PHP, JS, TS | error |
| `git-add-all` | `git add .` o `git add --all` | `.sh`, `.md`, `.yml` | warning |
| `barras-decorativas` | `====` o `----` en comentarios | PHP, JS, TS | information |

#### Estructura y tamaño

| ID | Descripción | Default |
|----|-------------|---------|
| `limite-lineas` | Archivo excede el límite de líneas del protocolo | warning |
| `usestate-excesivo` | Más de 3 `useState` en un mismo componente | warning |
| `import-muerto` | Import declarado pero no usado en el archivo | warning |

#### PHP / WordPress

| ID | Descripción | Default |
|----|-------------|---------|
| `controller-sin-trycatch` | Metodo publico de un Controller/Endpoint sin try-catch global. Excluye: `registerRoutes`, permission callbacks (`can*`, `verificar*`), y clases que usan trait `ConCallbackSeguro` | warning |
| `wpdb-sin-prepare` | `$wpdb->query/get_var/get_row/get_results/get_col` sin `prepare()`. Excluye: transacciones (`START TRANSACTION`, `ROLLBACK`, `COMMIT`), DDL, `prepare()` anidado como argumento y queries sin parámetros de usuario | error |
| `request-json-directo` | `get_json_params()` pasado directo a otra capa sin filtrar campos | warning |
| `json-decode-inseguro` | `json_decode()` sin verificar `json_last_error()` después | warning |
| `exec-sin-escapeshellarg` | `exec()`/`shell_exec()` sin `escapeshellarg()`. Excluye `proc_open()` con array (seguro en PHP 7.4+) | error |
| `curl-sin-verificacion` | `curl_exec()` sin verificar `curl_error()` en las siguientes 10 líneas | warning |
| `temp-sin-finally` | `tempnam()` sin `unlink` en bloque `finally` (riesgo de acumulación en `/tmp`) | warning |

#### React / TypeScript

| ID | Descripción | Default |
|----|-------------|---------|
| `useeffect-sin-cleanup` | `useEffect` con fetch/timers sin retornar cleanup con `AbortController` | warning |
| `mutacion-directa-estado` | `.splice()`, `.push()` o asignación directa a prop de estado React | warning |
| `zustand-sin-selector` | `useStore()` sin selector (re-render en cualquier cambio del store) | warning |
| `console-generico-en-catch` | `console.log` en un catch en lugar de `console.error` con contexto | warning |

## Lógica contextual — sin falsos positivos

Las siguientes reglas usan análisis de ventana de líneas en lugar de regex puro:

**`wpdb-sin-prepare`** — No reporta:
- `$wpdb->query('START TRANSACTION')`, `ROLLBACK`, `COMMIT`, `SAVEPOINT`
- DDL: `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`, `TRUNCATE`
- `$wpdb->get_row($wpdb->prepare(...))` — `prepare()` anidado como argumento
- Queries sin cláusulas que acepten input de usuario (`WHERE`, `JOIN`, `HAVING`, `SET`, `VALUES`)
- Variables construidas con `prepare()` hasta 50 líneas antes

**`controller-sin-trycatch`** -- No reporta:
- Metodos de registro de rutas: `registerRoutes()`, `register()`
- Permission callbacks: metodos `can*`, `verificar*`, `checkPermission*` (WordPress gestiona sus errores)
- Clases que usan `use ConCallbackSeguro` (el trait ya envuelve handlers en try-catch)
- Metodos triviales con menos de 5 lineas efectivas

**`exec-sin-escapeshellarg`** — No reporta:
- `proc_open($array, ...)` — array literal como primer argumento
- `proc_open($var, ...)` cuando `$var` fue definida como array en líneas cercanas

## Alias de baja latencia para Gemini CLI

Si usas Gemini CLI, define un alias `flash-min` con pensamiento mínimo.

Archivo `.gemini/settings.json`:

```json
{
  "modelConfigs": {
    "customAliases": {
      "flash-min": {
        "modelConfig": {
          "model": "gemini-3-flash-preview",
          "generateContentConfig": {
            "thinkingConfig": {
              "thinkingLevel": "minimal"
            }
          }
        }
      }
    }
  }
}
```

## Supresión puntual de reglas

Para suprimir una regla en una línea concreta:

```php
/* sentinel-disable-next-line regla-id */
```

O en línea (misma línea que el código):

```php
$codigo; /* sentinel-disable regla-id */
```

## Desarrollo local

```bash
cd .agent/code-sentinel
npm install
npm run compile
```

Luego presiona `F5` en VS Code para abrir un `Extension Development Host`.
