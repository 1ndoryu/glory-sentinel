use std::{env, fs, path::Path};
use zed_extension_api::{self as zed, LanguageServerId, Result};

const LANGUAGE_SERVER_ID: &str = "sentinel-lsp";
const BINARY_NAME: &str = "sentinel-lsp";
const ENV_SERVER_PATH: &str = "SENTINEL_LSP_PATH";
const DEV_SERVER_PATH: &str = "../../out/lsp/server.js";

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
        let server_path = env::current_dir().ok()?.join(DEV_SERVER_PATH);
        if fs::metadata(&server_path).is_ok_and(|metadata| metadata.is_file()) {
            Some(server_path.to_string_lossy().to_string())
        } else {
            None
        }
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
            "Could not find {BINARY_NAME}. Install Glory Sentinel on PATH, set {ENV_SERVER_PATH}, or run `npm run compile` in the Glory Sentinel repo before loading the dev integration."
        ))
    }
}

/* [105A-1] La integracion Zed solo localiza y lanza sentinel-lsp.
 * Gotcha: Zed no debe duplicar reglas ni empaquetar el LSP; usa PATH, SENTINEL_LSP_PATH o el out local de desarrollo. */
zed::register_extension!(GlorySentinelExtension);
