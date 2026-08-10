# Migración desde un gate legacy

## Prohibición principal

No copiar `scripts/quality`, `.agent`, `tools/quality` ni carpetas personales de otro proyecto. La carpeta
no determina ownership y no se elimina por su nombre.

## Flujo

1. Ejecutar `sentinel --help` y `sentinel doctor --json` desde el binario fijado.
2. Si el help ofrece `sentinel migrate`, ejecutar `sentinel migrate --project-root . --json`; si no,
   producir un inventario read-only de package scripts, CI, manifests, imports, entrypoints y reglas.
3. Clasificar cada archivo/regla:
   - universal (scope/cache/scheduler/reporter/lock/guard) → Sentinel Core;
   - regla genérica → Core o plugin publicado;
   - política/exclusión/severidad → configuración;
   - analyzer reutilizable → plugin fijado;
   - comprobación real del dominio/stack → adapter project-owned;
   - fixture → tests;
   - duplicado con paridad → eliminar;
   - desconocido → bloqueo, nunca borrado automático.
4. Registrar owner, rule ID, scope, severity, fixtures, timeout, coste, destino y sunset.
5. Ejecutar legacy y Core sobre el mismo scope-manifest en observe-only y comparar decisión, findings,
   líneas, severidad, estado y exit code.
6. Eliminar por commits reversibles: referencias, código muerto y tests exclusivos. Conservar fixtures de la
   capacidad migrada y demostrar rollback.

## Regla de admisión

Una extensión local solo permanece si es project-owned, no duplica Core/plugin, tiene fixtures positivos y
negativos, límites de recursos, presupuesto, justificación de dominio y condición de retirada. Un agente no
puede crear una carpeta personal que se convierta en parte del gate.

## Criterio de cierre

La migración no se cierra mientras exista una regla sin dueño, un executable no declarado, una referencia
productiva al legacy o una capacidad sin rollback. La retirada física de capas comunes exige dos releases
verdes consecutivas.
