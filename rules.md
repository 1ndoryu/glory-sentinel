# Reglas de Codigo — Code Sentinel

Catalogo generado desde src/config/ruleRegistry.ts (fuente unica de verdad). No editar a mano: `node scripts/catalogo-reglas.mjs`.
Formato: [id] nombre — severidad por defecto (desactivada por defecto).

Total: 125 reglas.

---

## estructura-nomenclatura

- [any-type-explicito] Tipo any explicito — hint
- [barras-decorativas] Barras decorativas — information
- [card-icono-debe-extender-base] CardIcono debe extender base compartida — warning
- [controller-fqn-inline] FQN inline en PHP — hint
- [css-adhoc-button-style] Estilo de boton ad-hoc en CSS — warning
- [css-elemento-html-directo] Selector HTML directo en componente — warning
- [css-especificacion-diseno-local] Especificacion de diseno local en CSS — warning
- [css-hardcoded-value] Color CSS hardcodeado — warning
- [default-export] Default export — hint (desactivada por defecto)
- [import-muerto] Import sin uso — warning
- [large-interface-isp] Interface grande ISP — hint
- [mixed-barrel-logic] Barrel con lógica — warning
- [modal-semantica-no-canonica] Clase modal semantica no canonica — warning
- [nomenclatura-css-ingles] CSS en ingles — hint (desactivada por defecto)
- [non-null-assertion-excesivo] Non-null assertion excesivo — hint
- [todo-pendiente] TODO/FIXME pendiente detectado — hint
- [todo-prosa-sin-marcador] Mencion 'todo' sin marcador de tarea — warning

## glory-schema

- [api-call-outside-service] API fuera de servicio — warning (desactivada por defecto)
- [api-endpoint-faltante] Endpoint frontend ausente en openapi.json — warning
- [api-response-mismatch] Mismatch clave API PHP vs TS — error (desactivada por defecto)
- [api-shape-mismatch] Shape mismatch array PHP vs TS — error (desactivada por defecto)
- [endpoint-accede-bd] Controller accede a BD — warning (desactivada por defecto)
- [glory-contenido-clave-incorrecta] 'content' en vez de 'contenido' — warning (desactivada por defecto)
- [glory-galeria-clave-incorrecta] 'galeria'/'gallery' en vez de 'galeriaAssets' — warning (desactivada por defecto)
- [glory-imagen-clave-incorrecta] 'imagen' en vez de 'imagenDestacadaAsset' — warning (desactivada por defecto)
- [glory-meta-clave-incorrecta] 'meta' en vez de 'metaEntrada' — error (desactivada por defecto)
- [glory-slug-clave-incorrecta] 'slug' en vez de 'slugDefault' — error (desactivada por defecto)
- [glory-titulo-clave-incorrecta] 'title'/'name' en vez de 'titulo' — error (desactivada por defecto)
- [hardcoded-enum-value] Valor enum hardcodeado — warning (desactivada por defecto)
- [hardcoded-sql-column] Columna SQL hardcodeada — warning (desactivada por defecto)
- [interval-sin-whitelist] INTERVAL sin whitelist — error (desactivada por defecto)
- [isla-no-registrada] Isla no registrada — warning (desactivada por defecto)
- [open-redirect] Redireccion insegura — error (desactivada por defecto)
- [return-void-critico] Escritura retorna void — warning (desactivada por defecto)
- [undefined-class-constant] Constante de clase indefinida — error (desactivada por defecto)

## limites-archivo

- [directorio-abarrotado] Directorio con demasiados archivos — warning
- [limite-lineas] Limite de lineas — warning
- [limite-lineas-nivel-2] Limite de lineas nivel 2 — warning
- [limite-lineas-nivel-3] Limite de lineas nivel 3 — error
- [limite-lineas-nivel-4] Limite de lineas nivel 4 — error

## patrones-prohibidos

- [at-generico-php] Supresor @ generico PHP — warning
- [catch-vacio] Catch vacio — error
- [console-generico-en-catch] console.log en catch — warning
- [console-production] Console en producción — warning
- [emoji-en-codigo] Emoji Unicode en codigo — warning
- [eval-prohibido] eval prohibido — error
- [exec-sin-escapeshellarg] exec sin escapeshellarg — error
- [git-add-all] git add . / --all — warning
- [hardcoded-secret] Secret hardcodeado — error
- [innerhtml-variable] innerHTML con variable — warning
- [mime-type-cliente] MIME type del cliente — error
- [php-supresor-at] Supresor @ en PHP — error
- [unsafe-process-shell] Proceso shell inseguro — error

## react-patrones

- [acceso-api-sin-fallback] Acceso a data.campo sin fallback — warning
- [button-clase-especifica] Clase específica en botón — warning
- [cola-sin-limite] push() a cola sin limite — warning
- [componente-artesanal] Componente artesanal detectado — warning
- [componente-sin-hook-glory] Componente sin hook dedicado — warning (desactivada por defecto)
- [dom-access-outside-platform] DOM fuera de plataforma — warning
- [error-enmascarado] Error enmascarado como exito — error
- [fallo-sin-feedback] Catch sin feedback al usuario — warning
- [fetch-sin-timeout] fetch() sin timeout — hint
- [formulario-config-sin-sistema-declarativo] Formulario de config manual sin sistema declarativo — warning
- [handler-sin-trycatch] Handler async sin try-catch — warning
- [html-nativo-en-vez-de-componente] HTML nativo en vez de componente — warning
- [html-sin-origen-declarado] Productor HTML sin declarar en allowlist — error
- [inline-style-prohibido] CSS inline con style={{}} — warning
- [key-index-lista] key={index} en lista — hint
- [listen-sin-cleanup] listen() sin cleanup — warning
- [menu-contextual-override-diseno] Override de diseño en MenuContextual — warning
- [modal-acciones-no-canonico] Clase de acciones no canónica en Modal — warning
- [modal-con-titulo] Título dentro de Modal — warning
- [modal-estructura-no-canonica] Estructura no canónica en Modal — warning
- [mutacion-directa-estado] Mutacion directa estado — warning
- [objeto-mutable-exportado] Objeto mutable exportado — hint
- [promise-sin-catch] Promise sin catch — warning
- [singleton-mutable-state] Singleton mutable — warning
- [status-http-generico] Status HTTP marca exito sin body — warning
- [update-optimista-sin-rollback] Update optimista sin rollback — warning
- [useeffect-dep-inestable] useEffect dep inestable — hint
- [useeffect-sin-cleanup] useEffect sin cleanup — warning
- [usestate-excesivo] useState excesivo — warning
- [window-reference-outside-platform] Window fuera de plataforma — warning
- [zustand-objeto-selector] Zustand selector crea ref nueva — warning
- [zustand-sin-selector] Zustand sin selector — warning

## rust-patrones

- [axum-ruta-sintaxis-rs] Sintaxis de parametro de ruta axum incorrecta para el stack — error
- [block-en-async-rs] block_on dentro de contexto async — error
- [broadcast-mutex-riesgo-rs] tokio::sync::broadcast usa Mutex interno — error
- [clone-bajo-lock-rs] .clone() bajo lock sincrono — warning
- [expect-produccion-rs] .expect() en produccion — error
- [funcion-larga-rs] Funcion Rust excede 100 lineas — warning
- [god-object-rs] Archivo god-object (>500 warn, >800 error) — warning
- [handler-accede-bd-rs] Handler Rust accede BD directamente — warning
- [lock-a-traves-await-rs] MutexGuard sincrono vivo a traves de .await — warning
- [panic-produccion-rs] panic!/todo!/unimplemented! en produccion — warning
- [parametros-excesivos-rs] Funcion Rust con 9+ parametros — hint
- [path-join-sin-canonicalize] Path.join() sin canonicalize() en el scope — error
- [port-fs-duplicado-rs] Contenido .rs duplicado con otro crate del workspace — warning
- [rusqlite-bloqueante-en-async] Mutex<Connection> rusqlite con .lock() en async — error
- [ruta-post-sin-rate-limit] Ruta POST sin rate limiting visible — error
- [secreto-en-log] Posible secreto interpolado en log — error
- [shell-modelo-sin-allowlist] Shell interactivo con argumento no literal — error
- [sqlite-carga-N-consultas] 3+ .await secuenciales sin join en la misma funcion — warning
- [unwrap-produccion-rs] .unwrap() en produccion — warning

## seguridad-sql

- [n-plus-1-query] Query N+1 en loop — warning
- [query-doble-verificacion] Query doble verificacion — information
- [repository-sin-whitelist-columnas] SELECT * sin columnas — hint
- [sqlx-query-as-sin-macro] sqlx::query_as sin macro — warning
- [sqlx-query-sin-macro] sqlx::query sin macro — warning
- [toctou-select-insert] TOCTOU select-insert — error
- [wpdb-sin-prepare] $wpdb sin prepare() — error (desactivada por defecto)

## wordpress-php

- [cadena-isset-update] Cadena isset-update — warning (desactivada por defecto)
- [catch-critico-solo-log] Catch critico solo log — warning (desactivada por defecto)
- [controller-sin-trycatch] Controller sin try-catch — warning (desactivada por defecto)
- [curl-sin-verificacion] curl_exec sin curl_error — warning (desactivada por defecto)
- [json-decode-inseguro] json_decode sin verificacion — warning (desactivada por defecto)
- [json-sin-limite-bd] JSON sin limite a BD — warning (desactivada por defecto)
- [lock-sin-finally] Lock sin finally — error (desactivada por defecto)
- [php-array-asociativo-como-lista] Array asociativo retornado como lista — warning (desactivada por defecto)
- [php-service-retorna-asociativo] Service retorna asociativo en vez de lista — warning (desactivada por defecto)
- [php-sin-return-type] PHP sin return type — hint (desactivada por defecto)
- [request-json-directo] JSON params sin filtrar — warning (desactivada por defecto)
- [retorno-ignorado-repo] Retorno repo ignorado — warning (desactivada por defecto)
- [sanitizacion-faltante] Request sin sanitizar — warning (desactivada por defecto)
- [temp-sin-finally] tempnam sin finally — warning (desactivada por defecto)
