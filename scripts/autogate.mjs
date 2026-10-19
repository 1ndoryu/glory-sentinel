// Autogate: Sentinel se analiza a sí mismo. Falla si quedan archivos con hallazgos.
// Uso: node scripts/autogate.mjs <ruta-del-reporte.json>
// Lo usan la CI y `quality:check`, así hay una sola definición del autogate.
// No usa `sentinel check --stages`: ese comando exige sentinel.lock.json y Sentinel no es consumidor de sí mismo (README).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const reporte = process.argv[2];
if (!reporte) {
  console.error('Uso: node scripts/autogate.mjs <reporte.json>');
  process.exit(2);
}

// Análisis real con el CLI compilado; el timeout acota la etapa del gate.
const analisis = spawnSync(
  process.execPath,
  ['out/cli/index.js', 'analyze', '--workspace', '.', '--format', 'json', '--output', reporte],
  { stdio: 'inherit', timeout: 600_000 },
);
if (analisis.status !== 0) {
  console.error(`Autogate: analyze terminó con código ${analisis.status ?? 'sin código'}`);
  process.exit(1);
}

// El CLI sale con 0 aunque haya hallazgos: el fallo lo decide este script.
const resultado = JSON.parse(readFileSync(reporte, 'utf8'));
if (resultado.totalArchivosConViolaciones > 0) {
  console.error(`Autogate: ${resultado.totalArchivosConViolaciones} archivos con hallazgos`);
  process.exit(1);
}
console.log(`Autogate: 0 archivos con hallazgos (${resultado.totalArchivos} analizados)`);
