import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const serverPath = path.join(root, 'out', 'lsp', 'server.js');
const fixtureRoot = path.join(root, 'fixtures', 'equivalence', 'language-selector-design-spec');
const fixtureFile = path.join(fixtureRoot, 'LanguageSelector.css');
const rootUri = `file:///${root.replace(/\\/g, '/')}`;
const documentUri = `file:///${fixtureFile.replace(/\\/g, '/')}`;

function sendMessage(child, message) {
  const body = JSON.stringify(message);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

const child = spawn(process.execPath, [serverPath, '--stdio'], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
let done = false;

const timeout = setTimeout(() => {
  if (done) {
    return;
  }

  done = true;
  child.kill();
  console.error(stdout || stderr || '[smoke-lsp-stdio] No output from sentinel-lsp');
  process.exit(1);
}, 5000);

child.stdout.on('data', chunk => {
  stdout += chunk.toString('utf8');

  if (stdout.includes('sentinel analyze') || stdout.includes('Uso:')) {
    done = true;
    clearTimeout(timeout);
    child.kill();
    console.error('[smoke-lsp-stdio] out/lsp/server.js executed CLI code instead of LSP server');
    process.exit(1);
  }

  if (stdout.includes('textDocument/publishDiagnostics') && stdout.includes('css-especificacion-diseno-local')) {
    done = true;
    clearTimeout(timeout);
    child.kill();
    console.log('[smoke-lsp-stdio] OK');
    process.exit(0);
  }
});

child.stderr.on('data', chunk => {
  stderr += chunk.toString('utf8');
});

child.on('exit', code => {
  if (done) {
    return;
  }

  done = true;
  clearTimeout(timeout);
  console.error(stderr || stdout || `[smoke-lsp-stdio] LSP exited early with code ${code}`);
  process.exit(1);
});

sendMessage(child, {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    processId: process.pid,
    rootUri,
    capabilities: {},
    workspaceFolders: [{ uri: rootUri, name: 'glory-sentinel' }],
  },
});

setTimeout(() => {
  sendMessage(child, {
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri: documentUri,
        languageId: 'css',
        version: 1,
        text: fs.readFileSync(fixtureFile, 'utf8'),
      },
    },
  });
}, 200);
