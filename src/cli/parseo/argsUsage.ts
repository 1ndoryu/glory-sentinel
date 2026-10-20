/* [108A-1 Fase 2] Textos de ayuda del CLI (usage general y de `task`). Van
 * aparte del parser para que el contrato de --help viva en un único sitio. */

/* Pedir ayuda no es un fallo: el parser lanza esta clase con el texto de uso y
 * el CLI la imprime en stdout con rc 0 (los errores de uso siguen con rc 2). */
export class AyudaSolicitada extends Error {}

/* Error de uso de una línea con la pista hacia la ayuda; el uso completo solo sale con --help. */
export function errorDeUso(mensaje: string, ayuda = '--help'): string {
  return `${mensaje} Ejecuta con ${ayuda}.`;
}

export function taskUsage(): string {
  return [
    'Uso de tareas:',
    '  sentinel task claim <id> --project-root <dir> --agent <id> [--force] [--json]',
    '  sentinel task start <id> --project-root <dir> --agent <id> [--primary-branch <branch>] [--path <dir>] [--worktrees-root <dir>] [--env-manifest <path>]',
    '  sentinel task heartbeat <id> --project-root <dir> --agent <id>',
    '  sentinel task status --project-root <dir> [--all] [--json]',
    '  sentinel task gate <id> --project-root <worktree> --agent <id> [--full|--ci]',
    '  sentinel task integrate <id> --project-root <dir> --agent <id> [--target <primary-branch>]',
    '  sentinel task cleanup <id> --project-root <dir> --agent <id> [--force]',
    '  sentinel task release <id> --project-root <dir> --agent <id>',
    '  sentinel task recover <id> --project-root <dir> --agent <id> [--dry-run] [--worktrees-root <dir>]',
  ].join('\n');
}

export function usage(): string {
  return [
    'Uso:',
    '  sentinel analyze --workspace . --format markdown --output .sentinel-report.md',
    '  sentinel analyze --file src/app.ts --format json',
    '  sentinel analyze --workspace . --files-from .changed-files --format json',
    '  sentinel check <task-id> --dry-run [--workspace .] [--full|--ci] [--profile rust,...]',
    '  sentinel check <task-id> --stages <json> [--full|--ci] [--workspace .]',
    '  sentinel guard --executable <exe> [--project-root <dir>] [--json] -- <args...>',
    '  sentinel doctor [--json] [--workspace .] [--shims]',
    '  sentinel status [--json] [--workspace .]',
    '  sentinel install [--target-root <dir>] [--source-root <dir>] [--version <v>] [--dry-run] [--with-shims] [--with-profiles] [--with-path] [--without-path] [--json]',
    '  sentinel update [--target-root <dir>] [--source-root <dir>] [--version <v>] [--dry-run] [--with-shims] [--with-profiles] [--with-path] [--without-path] [--json]',
    '  sentinel rollback [--target-root <dir>] [--version <v>] [--dry-run] [--json]',
    '  sentinel uninstall [--target-root <dir>] [--dry-run] [--keep-runtime] [--json]',
    '  sentinel lease issue --project-root <dir> [--task-id <id>] [--command <cmd>] [--ttl-ms <ms>] [--json]',
    '  sentinel lease list [--json]',
    '  sentinel lease revoke --lease <path> [--json]',
    '  sentinel lease verify --lease <path> [--project-root <dir>] [--pid <n>] [--json]',
    '  sentinel task claim|start|heartbeat|status|gate|integrate|cleanup|release|recover <id> [opciones]',
    '  sentinel init --preset <node|rust|python|mixed> [--project-root <dir>] [--primary-branch <rama>] [--dry-run] [--force] [--with-alias <nombre>] [--analyzer-version <v>] [--json]',
    '  sentinel migrate --project-root <dir> [--json]',
    '  sentinel uninit --project-root <dir> [--dry-run] [--json]',
    '  sentinel --version',
    '',
    'Opciones:',
    '  --workspace <path>  Analiza un workspace. Por defecto: cwd',
    '  --file <path>       Analiza un archivo puntual',
    '  --files-from <path> Lee archivos relativos al workspace, uno por linea',
    '  --format <type>     markdown | json. Por defecto: markdown',
    '  --output <path>     Escribe salida en archivo; si falta, imprime en stdout',
    '  --max-file-bytes <n> Omite en analyze los archivos mayores de n bytes (0 = sin límite; por defecto 1048576)',
    '  --deadline-ms <ms>  Corta analyze al llegar a ms, comprobado entre lotes (0 = sin límite)',
    '  --max-findings <n>  Muestra como máximo n hallazgos en analyze (0 = sin límite)',
    '  --config <path>     Carga sentinel.config.json',
    '  --task-id <id>      Tarea a comprobar (check)',
    '  --dry-run           Calcula el alcance sin ejecutar el gate (check)',
    '  --full / --ci       Fuerza alcance full (check)',
    '  --profile <csv>     Perfiles ejecutables explicitos (check)',
    '  --allow-heavy       Tolera full aunque el guard este en cooldown (check)',
    '  --stages <path>     Ejecuta las etapas declarativas JSON (check sin --dry-run)',
    '  --target-root <dir> Directorio del runtime global (install/update/rollback)',
    '  --source-root <dir> Origen del artefacto a instalar (install/update)',
    '  --version <v>       Version a instalar o restaurar (install/update/rollback)',
    '  --dry-run           Simula sin escribir nada (install/update/rollback)',
    '  --with-shims        Genera los shims interceptores en <target>/shims (install/update)',
    '  --with-profiles     Dot-sourcea el guard en los perfiles con backup previo (install/update)',
    '  --with-path         Añade <target>/shims al PATH de usuario (install/update; implica --with-shims)',
    '  --without-path      Retira <target>/shims del PATH de usuario (install)',
    '  --keep-runtime      Conserva versions/current/bin al desinstalar (uninstall)',
    '  --lease <path>      Ruta del lease (revoke/verify)',
    '  --pid <n>           PID a verificar como descendiente del emisor (verify)',
    '  --analyzer-version <v> Versión del analizador registrada en el lock (init; por defecto la del paquete)',
    '  --command <cmd>     Comando/propósito del lease (issue/verify)',
    '  --ttl-ms <ms>       TTL del lease en ms (issue)',
    '  --json              Salida JSON (guard/doctor/status/install/update/rollback/lease)',
    '  --help              Muestra esta ayuda',
    '  --version           Muestra la version instalada',
  ].join('\n');
}
