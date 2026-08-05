/* [028A-6 Fase 1] Runner de procesos del gate agnóstico.
 * Port de scripts/quality/runner.mjs: env allowlist, captura acotada de
 * stdout/stderr (64 KiB), timeout, cancelación cooperativa con sondeo y
 * terminación de árbol en Windows. Sin imports de wandori.us ni de VarSense. */
import { spawn, ChildProcess } from 'node:child_process';
import { truncate } from './redaction';

const ENV_ALLOWLIST = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'NUMBER_OF_PROCESSORS', 'CI', 'NO_COLOR', 'TERM', 'npm_execpath',
  'DATABASE_URL', 'CARGO_TARGET_DIR_BASE', 'GLORY_CARGO_TARGET_DIR',
  /* [297A-58] El lease pesado adquirido por el gate debe llegar a los
   * subcomandos pesados; el guard del proyecto ya las reconoce como override
   * sancionado. GLORY_QUALITY_GATE_TOKEN exime a las etapas internas del
   * guard de comandos directos (solo lo conoce el árbol de procesos del
   * gate). */
  'GLORY_HEAVY_RUN_TOKEN', 'GLORY_QUALITY_ALLOW_HEAVY', 'GLORY_QUALITY_GATE_TOKEN',
];
const MAX_CAPTURE_BYTES = 64 * 1024;
const activeChildren = new Set<ChildProcess>();

export interface ProcessResult {
  code: number;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface ToolRunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  isCancelled?: () => boolean;
}

interface Capture {
  text: string;
  truncated: boolean;
}

function appendOutput(capture: Capture, chunk: Buffer): Capture {
  const value = String(chunk);
  if (capture.text.length >= MAX_CAPTURE_BYTES) {
    capture.truncated = true;
    return capture;
  }
  const remaining = MAX_CAPTURE_BYTES - capture.text.length;
  capture.text += value.slice(0, remaining);
  capture.truncated ||= value.length > remaining;
  return capture;
}

function outputText(capture: Capture): string {
  return capture.truncated
    ? `${capture.text}\n...[quality output truncated at ${MAX_CAPTURE_BYTES} bytes]`
    : capture.text;
}

export function safeEnvironment(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

/* [018A-4] Herramientas ruidosas no acumulan stdout/stderr sin límite; el
 * marcador de truncado conserva una señal visible para pedir el log original. */
function terminateTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
}

export function cancelAll(): void {
  for (const child of activeChildren) terminateTree(child);
}

export function runProcess(
  executable: string,
  args: string[],
  options: ToolRunOptions = {},
): Promise<ProcessResult> {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const initiallyCancelled = Boolean(options.isCancelled?.());
    if (initiallyCancelled) {
      resolve({ code: 130, signal: null, timedOut: false, cancelled: true, durationMs: 0, stdout: '', stderr: '' });
      return;
    }
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: safeEnvironment(options.env),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.add(child);
    const stdout: Capture = { text: '', truncated: false };
    const stderr: Capture = { text: '', truncated: false };
    let timedOut = false;
    let cancellationObserved = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateTree(child);
    }, options.timeoutMs ?? 120_000);
    const cancellationTimer = setInterval(() => {
      if (!timedOut && !cancellationObserved && options.isCancelled?.()) {
        cancellationObserved = true;
        terminateTree(child);
      }
    }, 10);

    child.stdout.on('data', chunk => appendOutput(stdout, chunk));
    child.stderr.on('data', chunk => appendOutput(stderr, chunk));
    child.on('error', error => {
      clearTimeout(timer);
      clearInterval(cancellationTimer);
      activeChildren.delete(child);
      resolve({
        code: 2,
        signal: null,
        timedOut: false,
        cancelled: cancellationObserved,
        durationMs: Date.now() - startedAt,
        stdout: '',
        stderr: error.message,
      });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearInterval(cancellationTimer);
      activeChildren.delete(child);
      const cancelled = !timedOut && cancellationObserved;
      resolve({
        code: timedOut ? 2 : cancelled ? 130 : code ?? 2,
        signal,
        timedOut,
        cancelled,
        durationMs: Date.now() - startedAt,
        stdout: truncate(outputText(stdout)),
        stderr: truncate(outputText(stderr)),
      });
    });
  });
}
