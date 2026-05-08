/*
 * Reglas de contrato API: detectan desajustes entre
 * lo que PHP devuelve y lo que TypeScript consume.
 *
 * Regla 1: api-response-mismatch
 *   Cruza claves del generic de fetchAdmin con el indice PHP.
 *   "La clave 'X' no existe en la respuesta PHP de '/admin/Y'."
 *
 * Regla 2: acceso-api-sin-fallback
 *   Detecta setState(data.campo) sin ?? fallback.
 *   "data.campo puede ser undefined si la API no lo incluye."
 *
 * Regla 3: api-shape-mismatch (nueva)
 *   Cruza shape del valor PHP (array indexado vs asociativo) con tipo TS (Type[]).
 *   "PHP devuelve array asociativo para 'dias' pero TS espera CalendarioDia[]."
 *
 * Regla 4: api-response-mismatch (ampliada)
 *   Ahora tambien detecta useWordPressApi<ImportedType>(endpoint)
 *   resolviendo tipos importados via tsTypeResolver.
 */

import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';
import { buscarContratoPorSlug, buscarContratoPorRuta, obtenerContratos } from './apiContractIndexer';
import { resolverCamposTipo, obtenerIndiceTipos } from './tsTypeResolver';

/*
 * Detecta mismatch entre las claves que TS espera y las que PHP devuelve.
 *
 * Patrones detectados:
 *   1. fetchAdmin<{ success: boolean; campo: Type }>('endpoint')
 *   2. useWordPressApi<ImportedType>(endpoint)           ← NUEVO
 *   3. useWordPressApi<ImportedType>(`/glory/v1/path`)   ← NUEVO
 *
 * Para el patron 2/3, resuelve el tipo importado via tsTypeResolver
 * y luego cruza con el indice PHP.
 */
export function verificarApiResponseMismatch(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];
  const contratos = obtenerContratos();
  if (!contratos || contratos.size === 0) { return violaciones; }

  /*
   * Patron 1: fetchAdmin<{ ...campos... }>('endpoint')
   * Grupo 1: contenido del generic <{...}>
   * Grupo 2: endpoint string
   */
  const regexFetchInline = /fetch\w*<\{([^}]+)\}>\s*\(\s*['"`]([^'"`]+)['"`]/;

  /*
   * Patron 2: useWordPressApi<TipoImportado>(endpoint)
   * Grupo 1: nombre del tipo importado
   * Grupo 2: endpoint string o template literal
   */
  const regexUseApi = /useWordPressApi<(\w+)>\s*\(\s*['"`]([^'"`]+)['"`]/;
  const regexUseApiTemplate = /useWordPressApi<(\w+)>\s*\(\s*`([^`]+)`/;

  /*
   * Patron 3: apiGet<TipoImportado>('endpoint') | apiPost<TipoImportado>('endpoint')
   * Cubre el helper del modulo Kamples (apiCanciones.ts, etc.)
   * Grupo 1: nombre del tipo importado
   * Grupo 2: endpoint string
   */
  const regexApiGet = /api(?:Get|Post|Put|Delete|Patch)<(\w+)>\s*\(\s*['"`]([^'"`]+)['"`]/;

  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i])) { continue; }
    if (tieneSentinelDisable(lineas, i, 'api-response-mismatch')) { continue; }

    /* Intentar Patron 1: inline generic */
    const matchInline = regexFetchInline.exec(lineas[i]);
    if (matchInline) {
      violaciones.push(...verificarInlineGeneric(matchInline[1], matchInline[2], i));
      continue;
    }

    /* Intentar Patron 2: useWordPressApi<NombreTipo> */
    const matchApi = regexUseApi.exec(lineas[i]) || regexUseApiTemplate.exec(lineas[i]);
    if (matchApi) {
      violaciones.push(...verificarTipoImportado(matchApi[1], matchApi[2], i));
      continue;
    }

    /* Intentar Patron 3: apiGet<Tipo>('ruta') — services de Kamples */
    const matchApiGet = regexApiGet.exec(lineas[i]);
    if (matchApiGet) {
      violaciones.push(...verificarTipoImportado(matchApiGet[1], matchApiGet[2], i));
    }
  }

  return violaciones;
}
/*
 * Patron 1: verifica claves de un generic inline {campo: Tipo} contra PHP.
 */
function verificarInlineGeneric(genericContent: string, endpoint: string, linea: number): Violacion[] {
  const violaciones: Violacion[] = [];

  const clavesTs = new Set<string>();
  const regexClave = /(\w+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = regexClave.exec(genericContent)) !== null) {
    if (m[1] !== 'success') {
      clavesTs.add(m[1]);
    }
  }
  if (clavesTs.size === 0) { return violaciones; }

  const contrato = buscarContratoPorSlug(endpoint);
  if (!contrato) { return violaciones; }

  const clavesPhp = new Set<string>();
  for (const c of contrato.claves) {
    if (c !== 'success') { clavesPhp.add(c); }
  }

  for (const claveTs of clavesTs) {
    if (!clavesPhp.has(claveTs)) {
      const disponibles = [...clavesPhp].join(', ');
      violaciones.push({
        reglaId: 'api-response-mismatch',
        mensaje: `Clave '${claveTs}' no existe en la respuesta PHP del endpoint '${contrato.ruta}'. ` +
          `Claves disponibles: ${disponibles || '(ninguna indexada)'}.`,
        severidad: obtenerSeveridadRegla('api-response-mismatch'),
        linea,
        sugerencia: `Verificar que el controller PHP devuelva '${claveTs}' en WP_REST_Response, ` +
          `o corregir el nombre de la clave en el tipo generico del fetch.`,
        fuente: 'estatico',
      });
    }
  }

  for (const clavePHP of clavesPhp) {
    if (!clavesTs.has(clavePHP)) {
      violaciones.push({
        reglaId: 'api-response-mismatch',
        mensaje: `PHP devuelve '${clavePHP}' en '${contrato.ruta}' pero no se declara en el tipo generico. ` +
          `Si se accede a data.${clavePHP}, no tendra tipo seguro.`,
        severidad: 'information',
        linea,
        sugerencia: `Agregar '${clavePHP}: TipoEsperado' al tipo generico del fetch.`,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
/*
 * Patron 2: resuelve un tipo importado (e.g. VehiculoDetalleResponse)
 * y verifica tanto claves como shapes contra PHP.
 */
function verificarTipoImportado(nombreTipo: string, endpoint: string, linea: number): Violacion[] {
  const violaciones: Violacion[] = [];

  /* Resolver tipo TS  */
  const indiceTipos = obtenerIndiceTipos();
  if (!indiceTipos) { return violaciones; }

  const campos = resolverCamposTipo(nombreTipo);
  if (!campos) { return violaciones; }

  /* Buscar contrato PHP por endpoint */
  const contrato = buscarContratoPorRuta(endpoint) || buscarContratoPorSlug(
    endpoint.replace(/^\/?(glory\/v\d+\/)/, '').replace(/\/+$/, '')
  );
  if (!contrato) { return violaciones; }

  /*
   * Usar payloadClaves (sub-claves dentro de data:{}) si existen.
   * En el patron Glory/Kamples, el TS consume resp.data, no el wrapper completo.
   * Filtrar meta-claves del nivel superior para evitar falsos positivos.
   */
  const META_CLAVES = new Set(['ok', 'data', 'error', 'message', 'success']);
  const clavesEfectivas: Set<string> = (contrato.payloadClaves && contrato.payloadClaves.size > 0)
    ? contrato.payloadClaves
    : new Set([...contrato.claves].filter(c => !META_CLAVES.has(c)));

  /*
   * Claves tipicas de wrappers/paginacion — no son campos de datos reales.
   * Si clavesEfectivas solo tiene estas claves, el indexer no pudo ver el
   * payload real (data contiene una variable, no claves inline).
   * Verificar contra estos campos produciria falsos positivos masivos.
   */
  const CLAVES_WRAPPER = new Set([
    'data', 'pagination', 'paginacion', 'total', 'page', 'per_page',
    'pages', 'total_pages', 'has_more', 'next_page',
  ]);
  if (clavesEfectivas.size === 0 ||
      [...clavesEfectivas].every(c => CLAVES_WRAPPER.has(c))) {
    return violaciones;
  }

  /*
   * Heuristica overlap cero: si NINGUNO de los campos TS obligatorios coincide
   * con las claves PHP y hay >3 campos, el contrato matcheado es probablemente
   * incorrecto (mismo endpoint, diferente HTTP method o controller delegado).
   */
  const camposObligatorios = [...campos.entries()]
    .filter(([n, c]) => n !== 'success' && !c.opcional)
    .map(([n]) => n);
  const tieneOverlap = camposObligatorios.some(c => clavesEfectivas.has(c));
  if (!tieneOverlap && camposObligatorios.length > 3) {
    return violaciones;
  }

  /* Verificar claves: TS espera pero PHP no devuelve */
  for (const [campoNombre, campoInfo] of campos) {
    if (campoNombre === 'success') { continue; }
    /* Campos opcionales (?) pueden estar ausentes en PHP — no es mismatch */
    if (campoInfo.opcional) { continue; }

    if (!clavesEfectivas.has(campoNombre)) {
      violaciones.push({
        reglaId: 'api-response-mismatch',
        mensaje: `Tipo '${nombreTipo}' espera clave '${campoNombre}' pero PHP no la devuelve en '${contrato.ruta}'. ` +
          `Claves PHP (data): ${[...clavesEfectivas].join(', ') || '(ninguna)'}.`,
        severidad: obtenerSeveridadRegla('api-response-mismatch'),
        linea,
        sugerencia: `Verificar que el controller PHP devuelva '${campoNombre}' o corregir el tipo '${nombreTipo}'.`,
        fuente: 'estatico',
      });
    }
  }

  /* Verificar shapes: TS espera Type[] pero PHP devuelve array asociativo */
  for (const [campoNombre, campoInfo] of campos) {
    if (!campoInfo.esArray) { continue; }

    const shapePHP = contrato.shapes.get(campoNombre);
    if (!shapePHP || shapePHP === 'desconocido' || shapePHP === 'escalar') { continue; }

    if (shapePHP === 'array_asociativo') {
      violaciones.push({
        reglaId: 'api-shape-mismatch',
        mensaje: `PHP devuelve array ASOCIATIVO para '${campoNombre}' en '${contrato.ruta}', ` +
          `pero TS espera '${campoInfo.tipoRaw}' (array indexado). ` +
          `En JSON, el asociativo se serializa como objeto {} y .map() fallara.`,
        severidad: obtenerSeveridadRegla('api-shape-mismatch'),
        linea,
        sugerencia: `En PHP, usar $arr[] = ... en vez de $arr[$key] = ... para producir un array indexado, ` +
          `o aplicar array_values() antes de retornar.`,
        fuente: 'estatico',
      });
    }
  }

  /* Verificar shapes para campos con valor inline que llama a metodos */
  for (const clavePHP of clavesEfectivas) {
    const campoTs = campos.get(clavePHP);
    if (!campoTs) { continue; }
    if (!campoTs.esArray) { continue; }

    const shapePHP = contrato.shapes.get(clavePHP);
    if (shapePHP === 'array_asociativo') {
      /* Ya reportado arriba, evitar duplicado */
      if (!campos.has(clavePHP)) {
        violaciones.push({
          reglaId: 'api-shape-mismatch',
          mensaje: `PHP devuelve array asociativo para '${clavePHP}' pero TS espera '${campoTs.tipoRaw}'.`,
          severidad: obtenerSeveridadRegla('api-shape-mismatch'),
          linea,
          sugerencia: `Usar array_values() o $arr[] = ... en el PHP para producir array indexado.`,
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}
