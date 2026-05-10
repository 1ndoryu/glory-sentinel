function normalizarRuta(ruta: string): string {
  return ruta.replace(/\\/g, '/').replace(/\/+$/, '');
}

let workspaceRoots: string[] = [];

export function configurarWorkspaceRoots(roots: string[]): void {
  const vistos = new Set<string>();
  workspaceRoots = roots
    .map(root => root.trim())
    .filter(Boolean)
    .map(normalizarRuta)
    .filter(root => {
      if (vistos.has(root)) {
        return false;
      }
      vistos.add(root);
      return true;
    });
}

export function obtenerWorkspaceRoots(): string[] {
  return workspaceRoots;
}

export function resolverWorkspaceRoot(fileName?: string, explicitRoot?: string): string | null {
  if (explicitRoot) {
    return explicitRoot;
  }

  if (!fileName) {
    return workspaceRoots[0] ?? null;
  }

  const normalizedFile = normalizarRuta(fileName);
  return workspaceRoots.find(root => normalizedFile === root || normalizedFile.startsWith(`${root}/`)) ?? workspaceRoots[0] ?? null;
}

/* [105A-2] Raices de workspace compartidas por CLI, LSP y VS Code.
 * Gotcha: el core nunca consulta vscode.workspace; cada adaptador inyecta estas raices al iniciar. */