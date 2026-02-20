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

## Comandos disponibles

| Comando | Descripción |
|---------|-------------|
| `Glory Sentinel: Analizar Archivo Actual` | Fuerza análisis completo del archivo activo |
| `Glory Sentinel: Analizar Workspace` | Escanea el workspace (estático) |
| `Glory Sentinel: Limpiar Diagnosticos` | Limpia todos los diagnósticos |
| `Glory Sentinel: Activar/Desactivar IA` | Enciende o apaga el análisis IA |
| `Glory Sentinel: Ver Resumen de Reglas` | Muestra reglas activas |

## Configuración recomendada

```json
{
  "codeSentinel.staticAnalysis.enabled": true,
  "codeSentinel.aiAnalysis.enabled": true,
  "codeSentinel.ai.backend": "gemini-cli",
  "codeSentinel.ai.geminiModel": "flash-min",
  "codeSentinel.timing.staticDebounceMs": 500,
  "codeSentinel.timing.aiDelayOnOpenMs": 5000,
  "codeSentinel.timing.aiDelayOnEditMs": 30000,
  "codeSentinel.timing.aiCooldownMs": 300000,
  "codeSentinel.timing.aiTimeoutMs": 45000
}
```

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
