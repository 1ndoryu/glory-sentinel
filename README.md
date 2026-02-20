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

- Límites de tamaño por tipo de archivo.
- Patrones prohibidos (`eval`, supresores peligrosos, catches vacíos, secretos hardcodeados).
- SQL inseguro (`$wpdb` sin `prepare`, interpolaciones en query strings).
- Reglas React/TS (mutación de estado, efectos sin cleanup, exceso de estado local).
- Reglas PHP/WordPress (sanitización, endpoints inseguros, flujo de errores).

### 2) Análisis IA contextual

- Detección de violaciones semánticas que no se capturan bien con regex.
- Revisión de separación lógica/vista y responsabilidades por componente.
- Detección de errores enmascarados y flujos inconsistentes entre UI y backend.

### 3) Reporte de workspace

Al ejecutar "Analizar Workspace", se genera automáticamente un archivo `.sentinel-report.md` con:
- Conteo de violaciones por severidad (error / warning / info / hint).
- Tabla por archivo con línea, regla y mensaje, ordenada por gravedad.
- Configurable via `codeSentinel.reportPath`.

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
    "css-nomenclatura-ingles": { "habilitada": false },
    "catch-vacio": { "severidad": "warning" },
    "hardcoded-secret": { "severidad": "error" }
  }
}
```

### IDs de reglas disponibles

| ID | Descripción | Default |
|----|-------------|---------|
| `php-supresor-at` | Supresor `@` en funciones PHP | error |
| `at-generico-php` | Supresor `@` genérico | warning |
| `eval-prohibido` | `eval()` en cualquier lenguaje | error |
| `innerhtml-variable` | `innerHTML` con variable (XSS) | warning |
| `catch-vacio` | Catch vacío sin logging | error |
| `hardcoded-secret` | Password/API key en código | error |
| `git-add-all` | `git add .` / `--all` | warning |
| `barras-decorativas` | `====` en comentarios | information |
| `css-inline-jsx` | `style={{}}` en JSX | warning |
| `limite-lineas` | Archivo excede límite de líneas | warning |
| `usestate-excesivo` | Más de 3 useState en componente | warning |
| `import-muerto` | Import sin uso | warning |
| `controller-sin-trycatch` | Endpoint sin try-catch global | warning |
| `wpdb-sin-prepare` | `$wpdb->query()` sin `prepare()` | error |
| `request-json-directo` | `get_json_params()` sin filtrar | warning |
| `json-decode-inseguro` | `json_decode()` sin `json_last_error()` | warning |
| `exec-sin-escapeshellarg` | `exec()` sin `escapeshellarg()` | error |
| `curl-sin-verificacion` | `curl_exec()` sin `curl_error()` | warning |
| `temp-sin-finally` | `tempnam()` sin cleanup en `finally` | warning |
| `useeffect-sin-cleanup` | `useEffect` con fetch sin AbortController | warning |
| `mutacion-directa-estado` | Mutación directa de estado React | warning |
| `zustand-sin-selector` | `useStore()` sin selector | warning |
| `console-generico-en-catch` | `console.log` en catch en vez de `console.error` | warning |
| `css-color-hardcodeado` | Color hex/rgb hardcodeado en CSS | information |
| `css-nomenclatura-ingles` | Clase CSS con nombre en inglés | information |

## Alias de baja latencia para Gemini CLI

Si usas Gemini CLI, define un alias `flash-min` con pensamiento mínimo:

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

```c
/* sentinel-disable-next-line regla-id */
```

## Desarrollo local

```bash
cd .agent/code-sentinel
npm install
npm run compile
```

Luego presiona `F5` en VS Code para abrir un `Extension Development Host`.
