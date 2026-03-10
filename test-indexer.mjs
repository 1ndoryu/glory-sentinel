import { readFileSync } from 'fs';

const contenido = readFileSync('../../App/Kamples/Api/Controladores/CancionesController.php', 'utf-8');
const lineas = contenido.split('\n');

/* Paso 1 */
const rutaMetodo = new Map();
const regexRuta = /register_rest_route\s*\(\s*(?:['"][^'"]+['"]|\$\w+)\s*,\s*['"]([^'"]+)['"]/;
const regexCallback = /['"]callback['"]\s*=>\s*\[\s*self::class\s*,\s*['"](\w+)['"]\s*\]/;

for (let i = 0; i < lineas.length; i++) {
  const m = regexRuta.exec(lineas[i]);
  if (!m) continue;
  let cb = null;
  for (let j = i; j < Math.min(i + 6, lineas.length); j++) {
    const mc = regexCallback.exec(lineas[j]);
    if (mc) { cb = mc[1]; break; }
  }
  if (cb) rutaMetodo.set(cb, m[1]);
}

console.log('=== Paso 1: rutaMetodo ===');
for (const [k, v] of rutaMetodo) console.log(`  ${k} -> ${v}`);

/* Paso 2 */
const regexMetodo = /(?:public\s+)?(?:static\s+)?function\s+(\w+)\s*\(/;
const regexResponse = /new\s+\\?WP_REST_Response\s*\(\[/;
const regexClave = /['"](\w+)['"]\s*=>/;

let metodoActual = null, prof = 0, dentro = false;
const indexados = new Set();
const contratos = new Map();

for (let i = 0; i < lineas.length; i++) {
  const linea = lineas[i];
  const mm = regexMetodo.exec(linea);
  if (mm) { metodoActual = mm[1]; prof = 0; dentro = false; }
  for (const c of linea) {
    if (c === '{') { if (metodoActual && !dentro) dentro = true; prof++; }
    if (c === '}') prof--;
  }
  if (dentro && prof <= 0) { metodoActual = null; dentro = false; }
  if (!metodoActual || !dentro) continue;
  if (indexados.has(metodoActual)) continue;
  if (!regexResponse.test(linea)) continue;
  const ruta = rutaMetodo.get(metodoActual);
  if (!ruta) { console.log(`  [SKIP] metodo ${metodoActual} no tiene ruta registrada`); continue; }
  
  const claves = new Set(), payload = new Set();
  let pa = 0, ini = false;
  for (let j = i; j < Math.min(i + 40, lineas.length); j++) {
    const lr = lineas[j];
    if (ini && pa === 1) { const mc = regexClave.exec(lr); if (mc) claves.add(mc[1]); }
    if (ini && pa === 2) { const mc = regexClave.exec(lr); if (mc) payload.add(mc[1]); }
    for (const c of lr) { if (c === '[') { pa++; ini = true; } if (c === ']') pa--; }
    if (ini && pa <= 0) break;
  }
  
  if (claves.size > 0) {
    const norm = ruta.replace(/^\//, '').replace(/\(\?P<\w+>[^)]+\)/g, ':id').replace(/\\/g, '');
    contratos.set(norm, { metodo: metodoActual, claves: [...claves], payload: [...payload] });
    indexados.add(metodoActual);
    console.log(`  [OK] ${norm} -> ${metodoActual} | claves: ${[...claves]} | payload: ${[...payload]}`);
  }
}

console.log(`\n=== Total: ${contratos.size} contratos ===`);
const est = contratos.get('sample-discovery/estadisticas');
console.log('Endpoint estadisticas:', est ? 'ENCONTRADO' : 'NO ENCONTRADO');
if (est) console.log('  payloadClaves:', est.payload);

/* Paso 3: verificar TS type */
const tsCont = readFileSync('../../App/React/types/cancion.ts', 'utf-8');
const tsLineas = tsCont.split('\n');
const regexInterface = /^export\s+interface\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/;
const regexCampo = /^(?:readonly\s+)?(\w+)\??\s*:\s*(.+?)\s*;?\s*$/;
let campos = null;
for (let i = 0; i < tsLineas.length; i++) {
  const m = regexInterface.exec(tsLineas[i].trim());
  if (m && m[1] === 'EstadisticaRelaciones') {
    campos = new Map();
    let p = 0, ini2 = false;
    for (let j = i; j < tsLineas.length; j++) {
      const l = tsLineas[j].trim();
      if (ini2 && p === 1) {
        const mc = regexCampo.exec(l);
        if (mc) campos.set(mc[1], mc[2]);
      }
      for (const c of l) { if (c === '{') { p++; ini2 = true; } if (c === '}') p--; }
      if (ini2 && p <= 0) break;
    }
    break;
  }
}
console.log('\n=== TS type EstadisticaRelaciones ===');
console.log('campos:', campos ? [...campos.keys()] : 'NOT FOUND');

/* Paso 4: comparar */
if (est && campos) {
  const META = new Set(['ok', 'data', 'error', 'message', 'success']);
  const efec = est.payload.length > 0 ? new Set(est.payload) : new Set(est.claves.filter(c => !META.has(c)));
  console.log('\n=== Comparacion ===');
  console.log('clavesEfectivas PHP:', [...efec]);
  console.log('campos TS:', [...campos.keys()]);
  for (const [nombre] of campos) {
    if (!efec.has(nombre)) {
      console.log(`MISMATCH: TS espera '${nombre}' pero PHP no lo tiene. PHP tiene: ${[...efec]}`);
    }
  }
}
