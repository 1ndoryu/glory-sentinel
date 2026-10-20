import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';
import { esArchivoSoloTest } from '../rustTestScope';
import { REGLA_N_CONSULTAS, tieneDisableSiguiente, rangosFunciones } from './rustReglasCompartidas';

/* ------------------------------------------------------------------ */
/* [149A-1] sqlite-carga-N-consultas (warning)                         */
/* ------------------------------------------------------------------ */

/* Caso real: web_datos/conversaciones.rs:125-137 (docenas de queries en
 * bucle). Heuristica honesta: >=3 .await SOBRE PERSISTENCIA en la misma
 * funcion sin join!/try_join/JoinSet en el scope. Sin tipos no se sabe si
 * un await es una query: se cuentan los statements con .await cuyo CALLEE
 * nombra una API de persistencia (db/pool/sqlx/... seguido de `.metodo(`,
 * `::` o `!(`) — `ejecutar_git().await` o `sleep().await` no cuentan.
 * [229A-1] Precision: el calle, no los argumentos. `docker_exec(ssh,
 * postgres_container, &cmd).await` o `ssh.execute(cat ...{db_name}).await`
 * mencionan postgres/db en ARGUMENTOS pero el callee es exec remoto
 * (docker/ssh), no persistencia: no cuentan. `postgres`/`db_name`/`pg_db`
 * como identificadores sueltos tampoco cuentan (solo el callee). El mensaje
 * sigue siendo condicional ("si son consultas"). Una violacion por funcion,
 * en la linea del tercer await.
 * Precision H11 (harness 2026-09-14): antes contaba cada await (git.rs,
 * scheduler, cron daban warning sin tocar persistencia). El statement se
 * acumula hasta ';' para cazar cadenas multilinea (`.persistencia`
 * ... `.await` en lineas distintas). */
const UMBRAL_AWAITS_SECUENCIALES = 3;
const PATRON_AWAIT = /\.await\b/;
const PATRON_JOIN_ASYNC = /\bjoin!|try_join|JoinSet|join_all|futures::/;
/* [229A-1] El identificador de persistencia debe ir en posicion de callee:
 * `nombre ::`, `nombre!(`, `nombre.metodo(` o `nombre(`. Asi `db.x()`,
 * `sqlx::query(..)`, `pool.acquire()`, `query_as!(..)` o
 * `comun.persistencia.listar(..)` cuentan, pero `docker_exec(..,
 * postgres_container, ..)` / `ssh.execute(..{db_name}..)` no: el callee es
 * docker/ssh aunque los argumentos hablen de postgres. `\b` impide que
 * `database_manager` o `db_name` matcheen (`_` es word-char). `postgres`
 * queda fuera a proposito: nombra contenedores, no APIs. */
const PATRON_PERSISTENCIA_CALLEE =
  /\b(sqlx|pool|conn|connection|persistencia|sqlite|diesel|rusqlite|sea_orm|mongodb?|supabase|surreal(db)?|database|db|query\w*|stmt|fetch_\w*|dao|repositor\w*)\b\s*(::|!\s*\(|\.\w+\s*\(|\()/;

/* [sqlite-carga] Falsos positivos medidos en un proyecto real (2026-10-10), varias causas:
 * - Ramas excluyentes: dos awaits en ramas distintas de un mismo if/else o
 *   match nunca corren juntos, asi que no suman. Cada await lleva su camino
 *   (cadena de if/match + indice de rama) y dos caminos son compatibles si
 *   no difieren en la rama de una misma cadena.
 * - Dependencia de datos: un await que usa el valor de un await previo
 *   (`.bind(epoch)`) no se puede agrupar con join!. Un handle de transaccion
 *   (`pool.begin()`, `acquire()`) no propaga dependencia.
 * - Transaccion o conexion: una query sobre `&mut *tx`, `&mut **tx` (sqlx sobre
 *   Transaction) o `&mut *conn` no admite join! (dos prestamos mutables de la
 *   misma conexion no compilan), asi que el remedio del mensaje no aplica y no
 *   cuenta. Sigue cubierta la dependencia de datos.
 * - Condiciones complementarias: dos `if` separados sobre el mismo atomo con
 *   polaridad opuesta (`x == "a"` y `!x.eq("a")`, `x != "a"`) nunca corren juntos
 *   (caso real: módulo REST de mensajes, línea 291). Se modelan como un atomo booleano. */
const PATRON_LITERAL_CADENA = /"(?:[^"\\]|\\.)*"/g;
const PATRON_LET = /\blet\s+(?:mut\s+)?(\([^)]*\)|[a-z_]\w*)\s*(?::[^=]*)?=/g;
const PATRON_HANDLE = /\.(begin|acquire|transaction)\s*\(/;
/* [por que] Query sobre una conexion o transaccion ya prestada: el executor es el
 * primer argumento de un metodo (`.execute(&mut **tx)`, `.fetch_one(&mut *conn)`).
 * Exigir `.metodo(` evita que un `tx: &mut Transaction` de la firma, que se
 * fusiona con la primera sentencia del cuerpo, excluya sus awaits. No exige el
 * nombre `tx`: el executor puede llamarse de cualquier forma. */
const PATRON_TRANSACCION = /\.\w+\s*\(\s*&mut\s*\*{0,2}\s*\w+\b/;
/* [por que] Un bloque con cabecera (`if let ... = x.await {`) cierra su statement
 * en esa linea. Si no, el cuerpo se fusiona con la cabecera y sus awaits heredan
 * la consulta del encabezado (falso positivo en el mismo módulo REST, línea 292). */
const PATRON_CABECERA_BLOQUE = /\b(?:if|else|match|while|for)\b[^;]*\{\s*$/;
const PATRON_ELSE = /\belse\b/;
const PATRON_IF = /\bif\b/;
const PATRON_MATCH = /\bmatch\b/;
const PATRON_BRAZO = /=>\s*$/;

/* [por que] Rama de un camino: una cadena if/match (cadena numerica) o un atomo
 * de condicion (`atomo:<clave>`, rama 1 = condicion cierta, 0 = falsa). */
interface RamaCamino { cadena: number | string; rama: number }
type Camino = ReadonlyArray<RamaCamino>;

/* [por que] Llaves dentro de literales (`format!("{x}")`, `'{'`) no abren ni
 * cierran bloques, y el comentario de linea tampoco. Conserva el texto de los
 * literales (`x == "a"` y `x != "b"` son atomos distintos): solo neutraliza
 * `{`, `}` y `;` dentro de ellos. */
const PATRON_LITERAL_O_COMENTARIO = /("(?:[^"\\]|\\.)*")|'(?:\\.|[^'\\])'|\/\/.*$/g;
function cabeceraSinRuido(linea: string): string {
  return linea.replace(PATRON_LITERAL_O_COMENTARIO, (trozo: string, cadena?: string) => {
    if (cadena !== undefined) { return cadena.replace(/[{};]/g, '_'); }
    return trozo.startsWith('//') ? '' : "'_'";
  });
}

/* [por que] Atomo de la condicion `a && b` de un `if` (sin `let` ni `||`): el
 * cuerpo solo corre si cada atomo se cumple. `x == "a"` y `!x.eq("a")` dan la
 * misma clave con ramas opuestas, asi que dos `if` complementarios no suman. */
function requisitosDeCondicion(cabecera: string): RamaCamino[] {
  const inicio = cabecera.search(PATRON_IF);
  if (inicio < 0) { return []; }
  const condicion = cabecera.slice(inicio + 2);
  if (/\blet\b|\|\|/.test(condicion)) { return []; }
  return condicion.split('&&').map(a => normalizarAtomo(a.trim()));
}

function normalizarAtomo(texto: string): RamaCamino {
  let t = texto;
  let valor = true;
  if (t.startsWith('!') && !t.startsWith('!=')) { valor = false; t = t.slice(1).trim(); }
  const comparacion = /^(.+?)\s*(==|!=)\s*(.+)$/.exec(t);
  const metodoEq = /^(.+?)\.eq\((.+)\)$/.exec(t);
  let clave = t;
  if (comparacion) {
    clave = `${comparacion[1]}==${comparacion[3]}`;
    if (comparacion[2] === '!=') { valor = !valor; }
  } else if (metodoEq) {
    clave = `${metodoEq[1]}==${metodoEq[2]}`;
  }
  return { cadena: `atomo:${clave.replace(/\s+/g, '')}`, rama: valor ? 1 : 0 };
}

interface MarcoBloque {
  camino: Camino;
  cadenaMatch?: number;
  brazos: number;
  cadenaIf?: number;
  ramaIf: number;
}

/* [por que] Maximo de awaits que corren en un mismo camino de ejecucion. Un
 * camino elige una rama por cadena (if/else o match); las consultas cuyo camino
 * lo respeta son sus awaits secuenciales. Enumerar caminos (y no encadenar
 * pares compatibles) evita contar juntas consultas de ramas incompatibles.
 * Si las combinaciones exceden el limite se cuentan todas (comportamiento previo). */
const LIMITE_COMBINACIONES = 4096;
function mejorCamino(consultas: ReadonlyArray<{ linea: number; camino: Camino }>): number[] {
  const ramasPorCadena = new Map<number | string, number[]>();
  for (const c of consultas) {
    for (const r of c.camino) {
      const ramas = ramasPorCadena.get(r.cadena) ?? [];
      if (!ramas.includes(r.rama)) { ramas.push(r.rama); }
      ramasPorCadena.set(r.cadena, ramas);
    }
  }
  const cadenas = [...ramasPorCadena.keys()];
  const opciones = cadenas.map(c => ramasPorCadena.get(c) ?? []);
  let combinaciones = 1;
  for (const o of opciones) { combinaciones *= o.length; }
  if (combinaciones > LIMITE_COMBINACIONES) { return consultas.map(c => c.linea); }

  const indice = opciones.map(() => 0);
  let mejor: number[] = [];
  for (let n = 0; n < combinaciones; n++) {
    const elegida = new Map<number | string, number>();
    cadenas.forEach((c, j) => elegida.set(c, opciones[j][indice[j]]));
    const lineas = consultas
      .filter(c => c.camino.every(r => elegida.get(r.cadena) === r.rama))
      .map(c => c.linea);
    if (lineas.length > mejor.length) { mejor = lineas; }
    for (let j = 0; j < indice.length; j++) {
      indice[j] += 1;
      if (indice[j] < opciones[j].length) { break; }
      indice[j] = 0;
    }
  }
  return mejor;
}

function identificadores(texto: string): Set<string> {
  return new Set(texto.match(/\b[a-z_]\w*\b/g) ?? []);
}

export function detectarCargaNConsultas(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, REGLA_N_CONSULTAS)) { return []; }
  if (esArchivoSoloTest(texto)) { return []; }
  if (!PATRON_AWAIT.test(texto)) { return []; }

  const violaciones: Violacion[] = [];

  for (const [inicio, fin] of rangosFunciones(lineas, rangoTests)) {
    const scope = lineas.slice(inicio, fin + 1).join('\n');
    if (PATRON_JOIN_ASYNC.test(scope)) { continue; }

    let contadorCadenas = 0;
    const pila: MarcoBloque[] = [{ camino: [], brazos: 0, ramaIf: 0 }];
    /* Cabecera del bloque que se abre: texto desde la ultima llave o ';'. */
    let encabezado = '';
    const caminoEnLinea = new Map<number, Camino>();
    /* Nombres ligados al valor de un await de persistencia (o de algo que lo usa). */
    const ligados = new Set<string>();
    const consultas: Array<{ linea: number; camino: Camino }> = [];

    /* `cabecera` conserva el texto de los literales (atomos); la estructura se
     * decide sobre una copia con los literales vaciados, como antes. */
    const abrirBloque = (padre: MarcoBloque, cabecera: string): MarcoBloque => {
      const estructura = cabecera.replace(PATRON_LITERAL_CADENA, '""');
      const hijo = (...ramas: RamaCamino[]): MarcoBloque => ({ camino: [...padre.camino, ...ramas], brazos: 0, ramaIf: 0 });
      if (PATRON_ELSE.test(estructura) && padre.cadenaIf !== undefined) {
        padre.ramaIf += 1;
        return hijo({ cadena: padre.cadenaIf, rama: padre.ramaIf });
      }
      if (PATRON_BRAZO.test(estructura) && padre.cadenaMatch !== undefined) {
        return hijo({ cadena: padre.cadenaMatch, rama: padre.brazos++ });
      }
      if (PATRON_IF.test(estructura)) {
        contadorCadenas += 1;
        padre.cadenaIf = contadorCadenas;
        padre.ramaIf = 0;
        return hijo({ cadena: contadorCadenas, rama: 0 }, ...requisitosDeCondicion(cabecera));
      }
      if (PATRON_MATCH.test(estructura)) {
        contadorCadenas += 1;
        return { camino: padre.camino, cadenaMatch: contadorCadenas, brazos: 0, ramaIf: 0 };
      }
      return { camino: padre.camino, brazos: 0, ramaIf: 0 };
    };

    let stmt = '';
    let stmtInicio = inicio;
    let stmtTieneDisable = false;
    const cerrarStmt = (cierre: number): void => {
      const cuerpo = stmt.replace(PATRON_LITERAL_CADENA, '""');
      const enlaces = [...cuerpo.matchAll(PATRON_LET)]
        .flatMap(m => [...identificadores(m[1])])
        .filter(n => n !== '_' && n !== 'mut' && n !== 'ref');
      const usaLigado = [...identificadores(cuerpo.replace(PATRON_LET, '='))].some(n => ligados.has(n));
      const esConsulta = PATRON_AWAIT.test(stmt) && PATRON_PERSISTENCIA_CALLEE.test(stmt);
      const esTransaccion = PATRON_TRANSACCION.test(stmt);
      if (esConsulta && !esTransaccion && !stmtTieneDisable && !usaLigado) {
        /* Linea del ultimo .await del statement. */
        for (let s = cierre; s >= stmtInicio; s--) {
          if (PATRON_AWAIT.test(lineas[s])) {
            consultas.push({ linea: s, camino: caminoEnLinea.get(s) ?? [] });
            break;
          }
        }
      }
      if (!PATRON_HANDLE.test(cuerpo) && (usaLigado || esConsulta)) {
        enlaces.forEach(n => ligados.add(n));
      }
      stmt = '';
      stmtInicio = cierre + 1;
      stmtTieneDisable = false;
    };

    for (let i = inicio; i <= fin; i++) {
      caminoEnLinea.set(i, pila[pila.length - 1].camino);
      const trimmed = lineas[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
      if (tieneDisableSiguiente(lineas, i, REGLA_N_CONSULTAS)) { stmtTieneDisable = true; }
      if (lineas[i].includes(`sentinel-disable ${REGLA_N_CONSULTAS}`)) { stmtTieneDisable = true; }
      const sanitizada = cabeceraSinRuido(lineas[i]);
      for (let k = 0; k < sanitizada.length; k++) {
        const c = sanitizada[k];
        /* [por que] El camino se registra en la posicion del `.await`, no al inicio
         * de la linea: `1 => { db.x().await; }` abre el brazo antes de la consulta. */
        if (sanitizada.startsWith('.await', k)) { caminoEnLinea.set(i, pila[pila.length - 1].camino); }
        if (c === '{') {
          pila.push(abrirBloque(pila[pila.length - 1], encabezado.trim()));
          encabezado = '';
        } else if (c === '}') {
          if (pila.length > 1) { pila.pop(); }
          encabezado = '';
        } else if (c === ';') {
          encabezado = '';
        } else {
          encabezado += c;
        }
      }
      if (stmt === '') { stmtInicio = i; }
      stmt += (stmt === '' ? '' : '\n') + lineas[i];
      if (lineas[i].includes(';') || PATRON_CABECERA_BLOQUE.test(sanitizada)) { cerrarStmt(i); }
    }
    if (stmt !== '') { cerrarStmt(fin); }

    /* Una violacion por funcion, en el await que alcanza el umbral del camino mas largo. */
    const lineasCamino = mejorCamino(consultas);
    if (lineasCamino.length >= UMBRAL_AWAITS_SECUENCIALES) {
      violaciones.push({
        reglaId: REGLA_N_CONSULTAS,
        mensaje: `${lineasCamino.length} .await sobre persistencia en la misma funcion sin join!/try_join (caso real conversaciones.rs:125-137). Si son consultas independientes, agrupar con join! o paginar.`,
        severidad: obtenerSeveridadRegla(REGLA_N_CONSULTAS),
        linea: lineasCamino[UMBRAL_AWAITS_SECUENCIALES - 1],
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
