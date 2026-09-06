// [297A-14] Fixture equivalencia: sintaxis de parametros de ruta axum.
// Sin Cargo.lock junto al fixture rige el legacy (stack desconocido):
// matchit 0.7 parsea `:param`; `{param}` devuelve 404 silencioso.
use axum::routing::{delete, get};
use axum::Router;

fn rutas() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/users/:id", get(get_user))
        .route("/admin/users/{id}", delete(delete_user))
        .route(
            "/articles/{slug}",
            get(get_article),
        );
}

// utoipa: {id} es templating OpenAPI (docs), NO routing — no debe flaggear
#[utoipa::path(get, path = "/api/articles/{id}")]
async fn get_article() {}
