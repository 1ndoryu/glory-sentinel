import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = path.join(repoRoot, 'src', 'core');
const allowedFiles = new Set(['vscodeAdapter.ts']);
const vscodeImportPattern = /import\s+(?:type\s+)?[\s\S]*?from\s+['"]vscode['"]|import\s*['"]vscode['"]|require\(\s*['"]vscode['"]\s*\)/g;

function walk(directory) {
  if (!fs.existsSync(directory)) {
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

for (const filePath of walk(coreRoot)) {
  if (allowedFiles.has(path.basename(filePath))) {
    continue;
  }

  const text = fs.readFileSync(filePath, 'utf8');
  vscodeImportPattern.lastIndex = 0;

  let match;
  while ((match = vscodeImportPattern.exec(text)) !== null) {
    violations.push({
      filePath,
      line: lineForIndex(text, match.index),
    });
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    const relativePath = path.relative(repoRoot, violation.filePath).replace(/\\/g, '/');
    console.error(`${relativePath}:${violation.line}:1 error: src/core no debe importar vscode fuera de vscodeAdapter.ts`);
  }
  process.exit(1);
}

console.log('[check-core-no-vscode] OK');
