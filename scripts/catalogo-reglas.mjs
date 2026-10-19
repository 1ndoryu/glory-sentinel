// Genera rules.md desde el registro compilado (fuente única de verdad).
// Uso: `node scripts/catalogo-reglas.mjs` para escribir; `--check` falla si rules.md está desfasado.
// Requiere `npm run compile` antes: lee out/, no src/.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { obtenerTodasLasReglas } from '../out/config/ruleRegistry.js';

const RUTA = fileURLToPath(new URL('../rules.md', import.meta.url));
const esCheck = process.argv.includes('--check');

/* Agrupa por categoría; ids ordenados para que el diff sea estable */
function generarCatalogo() {
  const reglas = obtenerTodasLasReglas().sort((a, b) => a.id.localeCompare(b.id));
  const porCategoria = new Map();
  for (const regla of reglas) {
    if (!porCategoria.has(regla.categoria)) porCategoria.set(regla.categoria, []);
    porCategoria.get(regla.categoria).push(regla);
  }
  const lineas = [
    '# Reglas de Codigo — Code Sentinel',
    '',
    'Catalogo generado desde src/config/ruleRegistry.ts (fuente unica de verdad). No editar a mano: `node scripts/catalogo-reglas.mjs`.',
    'Formato: [id] nombre — severidad por defecto (desactivada por defecto).',
    '',
    `Total: ${reglas.length} reglas.`,
    '',
    '---',
  ];
  for (const categoria of [...porCategoria.keys()].sort()) {
    lineas.push('', `## ${categoria}`, '');
    for (const r of porCategoria.get(categoria)) {
      const nota = r.habilitadaDefault === false ? ' (desactivada por defecto)' : '';
      lineas.push(`- [${r.id}] ${r.nombre} — ${r.severidadDefault}${nota}`);
    }
  }
  return lineas.join('\n') + '\n';
}

const generado = generarCatalogo();
if (esCheck) {
  const actual = readFileSync(RUTA, 'utf-8');
  if (actual !== generado) {
    console.error('rules.md está desfasado del registro. Ejecuta: node scripts/catalogo-reglas.mjs');
    process.exit(1);
  }
  console.log('rules.md al día con el registro');
} else {
  writeFileSync(RUTA, generado, 'utf-8');
  console.log('rules.md escrito');
}
