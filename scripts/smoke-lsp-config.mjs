// Smoke del LSP con un sentinel.config.json inválido: debe publicar un diagnóstico
// de error con el mismo mensaje que la CLI, en vez de aplicar la config a medias.
import { spawn } from 'child_process';
import path from 'path';

const root = process.cwd();
const serverPath = path.join(root, 'out', 'lsp', 'server.js');
const fixtureRoot = path.join(root, 'fixtures', 'lsp-config-invalida');
const rootUri = `file:///${fixtureRoot.replace(/\\/g, '/')}`;
const documentUri = `${rootUri}/Ejemplo.css`;

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

// Mismo margen que smoke-lsp-stdio: el arranque en frío puede superar 5 s con carga.
const timeout = setTimeout(() => {
  if (done) return;
  done = true;
  child.kill();
  console.error(stdout || stderr || '[smoke-lsp-config] Sin diagnóstico del LSP');
  process.exit(1);
}, 20000);

function terminar(codigo, mensaje) {
  done = true;
  clearTimeout(timeout);
  child.kill();
  (codigo === 0 ? console.log : console.error)(mensaje);
  process.exit(codigo);
}

child.stdout.on('data', chunk => {
  stdout += chunk.toString('utf8');
  if (done || !stdout.includes('textDocument/publishDiagnostics')) return;
  if (stdout.includes('lsp-analysis-error') && stdout.includes('clave desconocida')) {
    terminar(0, '[smoke-lsp-config] OK');
  }
});

child.stderr.on('data', chunk => {
  stderr += chunk.toString('utf8');
});

child.on('exit', code => {
  if (done) return;
  terminar(1, stderr || stdout || `[smoke-lsp-config] LSP salió con código ${code}`);
});

sendMessage(child, {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    processId: process.pid,
    rootUri,
    capabilities: {},
    workspaceFolders: [{ uri: rootUri, name: 'lsp-config-invalida' }],
  },
});

setTimeout(() => {
  sendMessage(child, {
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: { uri: documentUri, languageId: 'css', version: 1, text: 'a { color: red; }\n' },
    },
  });
}, 200);
