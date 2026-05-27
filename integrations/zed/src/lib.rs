use std::{env, path::Path};
use zed_extension_api::{self as zed, LanguageServerId, Result};

const LANGUAGE_SERVER_ID: &str = "sentinel-lsp";
const BINARY_NAME: &str = "sentinel-lsp";
const ENV_SERVER_PATH: &str = "SENTINEL_LSP_PATH";

/* [22A-2] La extension WASM no puede hacer fs::metadata a paths absolutos
 * (sandbox WASI preview 2). Pero zed::Command corre fuera del sandbox, asi
 * que retornamos el path absoluto (CARGO_MANIFEST_DIR) sin verificacion.
 * El shim lsp.launch.js usa Node.js require() que resuelve libremente. */

struct GlorySentinelExtension;

impl GlorySentinelExtension {
    fn command_from_path(server_path: String) -> Result<zed::Command> {
        if Path::new(&server_path)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("js"))
        {
            return Ok(zed::Command {
                command: zed::node_binary_path()?,
                args: vec![server_path, "--stdio".to_string()],
                env: Default::default(),
            });
        }

        Ok(zed::Command {
            command: server_path,
            args: vec!["--stdio".to_string()],
            env: Default::default(),
        })
    }

    fn local_dev_server_path() -> Option<String> {
        // Usamos CARGO_MANIFEST_DIR (compile-time) para path absoluto al shim.
        // No verificamos existencia con fs::metadata porque el sandbox WASI
        // bloquea acceso a paths fuera de directorios pre-abiertos.
        // Pero zed::Command corre fuera del sandbox, asi que el path funciona
        // aunque la extension WASM no pueda hacer stat().
        Some(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("lsp.launch.js")
                .to_string_lossy()
                .to_string(),
        )
    }
}

impl zed::Extension for GlorySentinelExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        if language_server_id.as_ref() != LANGUAGE_SERVER_ID {
            return Err(format!("Unknown language server ID {language_server_id}"));
        }

        if let Ok(server_path) = env::var(ENV_SERVER_PATH) {
            let trimmed = server_path.trim();
            if !trimmed.is_empty() {
                return Self::command_from_path(trimmed.to_string());
            }
        }

        if let Some(server_path) = worktree.which(BINARY_NAME) {
            return Self::command_from_path(server_path);
        }

        if let Some(server_path) = Self::local_dev_server_path() {
            return Self::command_from_path(server_path);
        }

        Err(format!(
            "Could not find {BINARY_NAME}. \
             Use `npm run compile` in the Glory Sentinel repo, \
             set {ENV_SERVER_PATH}=<path>, or add sentinel-lsp to PATH. \
             Expected shim at: lsp.launch.js"
        ))
    }
}

/* [105A-1] La integracion Zed solo localiza y lanza sentinel-lsp.
 * Fix [22A-2]: retorna path absoluto (CARGO_MANIFEST_DIR/lsp.launch.js)
 * sin fs::metadata. zed::Command corre fuera de sandbox WASI, el path
 * funciona aunque la extension WASM no pueda stat()lo. */
zed::register_extension!(GlorySentinelExtension);
