# Reglas de Codigo — Code Sentinel

Estas son las reglas que la IA debe verificar en cada archivo. Edita este archivo para agregar, modificar o eliminar reglas.

---

## PHP

- [sql-interpolado] PROHIBIDO concatenar variables en strings SQL. Usar `$wpdb->prepare()` obligatoriamente. Ejemplo malo: `"SELECT * FROM tabla WHERE id = $id"`.
- [supresor-at] PROHIBIDO `@` como supresor de errores (`@unlink`, `@file_get_contents`, etc.). Usar try-catch con logging.
- [try-catch-faltante] Operaciones de I/O, red, BD, `exec()`, `curl_exec()`, `json_decode()`, `file_get_contents()`, `ZipArchive` DEBEN estar en try-catch con logging util. Catch vacio o con solo `echo` no cuenta.
- [json-sin-validar] Despues de `json_decode()` SIEMPRE verificar `json_last_error() !== JSON_ERROR_NONE`. Sin esto los datos corruptos se propagan como null silencioso.
- [exec-sin-escapeshellarg] `exec()` y `shell_exec()` DEBEN usar `escapeshellarg()` para cada argumento que venga de input o BD. Sin esto hay riesgo de ejecucion de comandos arbitrarios.
- [sanitizacion-faltante] Todo parametro de request HTTP (`$_GET`, `$_POST`, `$request->get_param()`, `get_json_params()`) DEBE sanitizarse con `sanitize_text_field()`, `intval()`, `sanitize_email()`, etc. antes de usarlo.
- [endpoint-accede-bd] Controllers/endpoints REST NO deben tener queries `$wpdb` directas. La logica de datos va en modelos/repositorios/servicios.
- [controller-sin-trycatch] Todo metodo publico de un controller REST DEBE envolver su cuerpo en `try { ... } catch (\Throwable $e)` con logging y respuesta 500 generica.
- [multi-tabla-sin-transaccion] Operaciones de escritura que afectan mas de una tabla DEBEN usar transacciones (`START TRANSACTION` / `COMMIT` / `ROLLBACK`).
- [open-redirect] URLs recibidas del usuario usadas en `wp_redirect()` o `header('Location:')` DEBEN validarse con `wp_validate_redirect()` o verificar que el dominio es el propio.
- [hardcoded-secret] PROHIBIDO hardcodear API keys, passwords, tokens en el codigo. Usar variables de entorno o configuracion externa.
- [return-void-critico] Metodos que hacen INSERT/UPDATE/DELETE o llaman APIs externas DEBEN retornar `bool` o tipo verificable, no `void`.
- [archivos-temp-sin-finally] Si se crean archivos temporales con `tempnam()`, el `unlink()` DEBE ir en bloque `finally`.

---

## TypeScript / React (TSX/JSX)

- [separacion-logica-vista] Si un componente tiene mas de 5 lineas de logica (fetching, calculos, effects), extraer a un hook dedicado. El componente solo debe tener imports, destructuring y JSX.
- [error-enmascarado] En un `catch`, PROHIBIDO retornar `{ ok: true }` o datos vacios como si fuera exito. Siempre retornar `ok: false` o re-lanzar el error.
- [update-optimista-sin-rollback] Si se actualiza el estado UI antes de confirmar con la API, DEBE verificarse `resp.ok` y revertir el estado si falla. Detectado: set() de Zustand antes de await sin set() de rollback en catch.
- [useeffect-sin-cleanup] Todo `useEffect` que lance requests async DEBE retornar una funcion de cleanup con `AbortController`.
- [mutacion-directa-estado] PROHIBIDO `splice()`, `push()`, o asignacion directa a propiedades de objetos del estado React. Usar `map()` + spread.
- [zustand-sin-selector] `useStore()` sin selector re-renderiza en cualquier cambio del store. Usar `useStore(s => s.campo)`.
- [fallo-sin-feedback] Si una operacion falla, el usuario DEBE recibir feedback visible (toast, mensaje de error). `console.error` solo no es suficiente. Detectado: catch con solo console.error/log sin toast/notification.
- [try-catch-faltante-ts] Operaciones de fetch, I/O, APIs externas DEBEN estar en try-catch o manejar errores explicitamente.
- [componente-artesanal] PROHIBIDO reimplementar componentes que ya existen en el sistema (MenuContextual, Modal, etc.). Detectado: outside-click handlers manuales (document.addEventListener mousedown/click en useEffect) y overlays/backdrops artesanales.
- [fetch-sin-timeout] fetch() DEBE usar AbortController con signal/timeout. Sin timeout puede colgar indefinidamente. Excluye archivos que SON el wrapper HTTP.
- [non-null-assertion-excesivo] Archivos con 5+ non-null assertions (variable!.prop) indican tipos mal definidos. Tipar correctamente para evitar !.

---

## CSS

- [variables-obligatorias] Colores, espaciados y tipografia DEBEN usar variables CSS (`var(--nombre)`). PROHIBIDO hardcodear valores hex, rgb o rem directamente.
- [nomenclatura-css] Clases CSS DEBEN estar en espanol y camelCase. Ejemplo correcto: `.contenedorPrincipal`, `.botonActivo`. Incorrecto: `.main-container`, `.btn-active`.

---

## General (todos los archivos)

- [archivo-monolito] Ningun archivo debe superar 300 lineas (componentes/estilos), 120 lineas (hooks) o 150 lineas (utils). Si supera el limite, marcar como violacion.
- [srp-violado] Cada archivo debe tener una unica responsabilidad. Si mezcla logica de dominio con presentacion, o multiples features distintas, es violacion.
- [import-sin-usar] Imports que no se usan en el archivo son violacion.
- [catch-vacio] PROHIBIDO bloques `catch` vacios o que solo tengan un comentario. Siempre loguear o propagar el error.
