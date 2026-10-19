// Autogate: Sentinel se analiza a sí mismo. Falla si hay más archivos con hallazgos que el umbral versionado.
// Uso: node scripts/autogate.mjs [ruta-del-reporte.json]
// Lo usan la CI y `quality:check`, así hay una sola definición del autogate.
// No usa `sentinel check --stages`: ese comando exige sentinel.lock.json y Sentinel no es consumidor de sí mismo (README).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Umbral versionado en sentinel-autogate.json. Sin él, o con un valor no válido, el gate se niega a decidir.
const CONFIG_AUTOGATE = 'sentinel-autogate.json';
// Reporte temporal de cada ejecución: local, no versionado (ver .gitignore).
const REPORTE_POR_DEFECTO = '.sentinel-autogate-reporte.json';
// Acota la etapa de análisis: un análisis que se cuelga no debe bloquear la CI indefinidamente.
const TIMEOUT_ANALISIS_MS = 600_000;

const reporte = process.argv[2] ?? REPORTE_POR_DEFECTO;

// Fail-closed: un umbral ausente o inválido impide afirmar que el código pasa.
let umbral;
try {
  umbral = JSON.parse(readFileSync(CONFIG_AUTOGATE, 'utf8')).maxArchivosConHallazgos;
} catch (error) {
  console.error(`Autogate: no se pudo leer ${CONFIG_AUTOGATE} (${error.message})`);
  process.exit(2);
}
if (!Number.isInteger(umbral) || umbral < 0) {
  console.error(`Autogate: maxArchivosConHallazgos debe ser un entero >= 0 en ${CONFIG_AUTOGATE}`);
  process.exit(2);
}

// Análisis real con el CLI compilado.
const analisis = spawnSync(
  process.execPath,
  ['out/cli/index.js', 'analyze', '--workspace', '.', '--format', 'json', '--output', reporte],
  { stdio: 'inherit', timeout: TIMEOUT_ANALISIS_MS },
);
if (analisis.error?.code === 'ETIMEDOUT') {
  console.error(`Autogate: analyze superó ${TIMEOUT_ANALISIS_MS} ms`);
  process.exit(1);
}
if (analisis.status !== 0) {
  console.error(`Autogate: analyze terminó con código ${analisis.status ?? 'sin código'}`);
  process.exit(1);
}

// El CLI sale con 0 aunque haya hallazgos: el fallo lo decide este script.
const resultado = JSON.parse(readFileSync(reporte, 'utf8'));
const conHallazgos = resultado.totalArchivosConViolaciones;
// Fail-closed: si el reporte no trae el recuento, no se puede afirmar que no haya hallazgos.
if (!Number.isInteger(conHallazgos)) {
  console.error('Autogate: el reporte no trae totalArchivosConViolaciones; no se puede decidir');
  process.exit(1);
}
if (conHallazgos > umbral) {
  console.error(`Autogate: ${conHallazgos} archivos con hallazgos (umbral ${umbral})`);
  process.exit(1);
}
console.log(`Autogate: ${conHallazgos} archivos con hallazgos, umbral ${umbral} (${resultado.totalArchivos} analizados)`);
