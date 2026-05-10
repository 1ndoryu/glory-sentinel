import * as path from 'path';

export function languageIdForFile(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.php': return 'php';
    case '.tsx': return 'typescriptreact';
    case '.jsx': return 'javascriptreact';
    case '.ts': return 'typescript';
    case '.js': return 'javascript';
    case '.rs': return 'rust';
    case '.css': return 'css';
    case '.scss': return 'scss';
    case '.less': return 'less';
    default: return 'plaintext';
  }
}