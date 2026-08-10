import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = path.join(repoRoot, 'src', 'core');
const cliRoot = path.join(repoRoot, 'src', 'cli');
const analyzersRoot = path.join(repoRoot, 'src', 'analyzers');

/* [108A-1 Fase 2] Frontera editor-agnóstica: core, cli y analyzers corren en
 * Node puro (CLI/LSP/gate). Solo vscodeAdapter.ts toca la API del editor. */
const protectedPaths = [
  { root: coreRoot, allowedFiles: new Set(['vscodeAdapter.ts']) },
  /* externalToolsAnalyzer es un analyzer con integración VS Code (tasks,
   * terminales): vive del lado del editor y se porta al módulo editor en la
   * consolidación (ADR 0001, Fase 5). El resto de analyzers es agnóstico. */
  { root: analyzersRoot, allowedFiles: new Set(['externalToolsAnalyzer.ts']) },
  { root: cliRoot, allowedFiles: new Set() },
];
const allowedFiles = new Set(['vscodeAdapter.ts']);
const vscodeImportPattern = /import\s+(?:type\s+)?[\s\S]*?from\s+['"]vscode['"]|import\s*['"]vscode['"]|require\(\s*['"]vscode['"]\s*\)/g;

/* [108A-1 Fase 2] DIP: el núcleo/CLI no dependen de los módulos del editor
 * (handlers/providers/services/platform/extension) ni de scripts/quality del
 * consumidor. El gate depende de puertos estructurados, no de concretos. */
const editorModulePattern = /from\s+['"]\.\.\/(?:handlers|providers|services|platform|extension)(?:['"/])/g;
const consumerScriptsPattern = /from\s+['"][^'"]*scripts[\\/]quality[^'"]*['"]/g;

/* [108A-1 Fase 2] `sentinel check` es independiente de shims, perfiles y
 * worktrees: gateRun no puede acoplarse a interceptorShims ni taskCoordinator. */
const checkIndependenceRules = [
  { file: path.join(coreRoot, 'gateRun.ts'), forbidden: ['interceptorShims', 'taskCoordinator'] },
];

/* [108A-1 Fase 2] Budget de tamaño por módulo (ADR 0001 +
 * scripts/module-budgets.json). Los módulos listados no pueden crecer por
 * encima de su presupuesto; el top-10 de tamaños se reporta como visibilidad. */
const moduleBudgets = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'module-budgets.json'), 'utf8'));

function walk(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const stat = fs.statSync(directory);
  if (stat.isFile()) {
    return directory.endsWith('.ts') ? [directory] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return walk(entryPath);
    }

    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

function lineForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

const violations = [];
const warnings = [];

function checkFile(filePath, patterns, message) {
  const text = fs.readFileSync(filePath, 'utf8');
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      violations.push({ filePath, line: lineForIndex(text, match.index), message });
    }
  }
}

for (const protectedPath of protectedPaths) {
  for (const filePath of walk(protectedPath.root)) {
    if (allowedFiles.has(path.basename(filePath)) || protectedPath.allowedFiles.has(path.basename(filePath))) {
      continue;
    }
    checkFile(filePath, [vscodeImportPattern], 'core/cli/analyzers editor-agnosticos no deben importar vscode');
    checkFile(filePath, [editorModulePattern, consumerScriptsPattern], 'core/cli/analyzers no deben depender de modulos del editor ni de scripts/quality del consumidor (DIP)');
  }
}

for (const rule of checkIndependenceRules) {
  const text = fs.readFileSync(rule.file, 'utf8');
  for (const forbidden of rule.forbidden) {
    const pattern = new RegExp(`from\\s+['"]\\./${forbidden}['"]`, 'u');
    if (pattern.test(text)) {
      violations.push({
        filePath: rule.file,
        line: lineForIndex(text, text.indexOf(forbidden)),
        message: `gateRun no debe importar ${forbidden}: check es independiente de shims/perfiles/worktrees`,
      });
    }
  }
}

for (const [modulePath, budget] of Object.entries(moduleBudgets.modules)) {
  const full = path.join(repoRoot, modulePath);
  if (!fs.existsSync(full)) continue;
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/).length;
  if (lines > budget) {
    violations.push({
      filePath: full,
      line: budget,
      message: `excede el budget de tamaño: ${lines} lineas > ${budget} (ADR 0001)`,
    });
  }
}

const allFiles = [...walk(coreRoot), ...walk(cliRoot), ...walk(analyzersRoot)];
const topSizes = allFiles
  .map(file => ({ file, lines: fs.readFileSync(file, 'utf8').split(/\r?\n/).length }))
  .sort((a, b) => b.lines - a.lines)
  .slice(0, 10);
for (const { file, lines } of topSizes) {
  warnings.push(`${path.relative(repoRoot, file).replace(/\\/g, '/')}: ${lines} lineas`);
}

if (violations.length > 0) {
  for (const violation of violations) {
    const relativePath = path.relative(repoRoot, violation.filePath).replace(/\\/g, '/');
    console.error(`${relativePath}:${violation.line}:1 error: ${violation.message}`);
  }
  process.exit(1);
}

console.log('[check-core] OK');
for (const warning of warnings) console.log(`[check-core] top-tamano ${warning}`);
