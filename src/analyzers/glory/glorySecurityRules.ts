/*
 * Reglas de seguridad PHP especificas del framework Glory.
 * Detecta: endpoint accediendo a BD directamente, INTERVAL sin whitelist,
 * open redirect sin validacion.
 */

import * as path from 'path';
import { Violacion } from '../../types';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';

/*
 * Detecta queries directas en controllers/endpoints.
 * La logica de datos debe estar en un Repository o Service.
 */
export function verificarEndpointAccedeBd(lineas: string[], rutaArchivo: string): Violacion[] {
  const violaciones: Violacion[] = [];

  const nombreArchivo = path.basename(rutaArchivo);
  if (!/Controller|Endpoints/i.test(nombreArchivo)) { return violaciones; }

  if (rutaArchivo.includes('/Glory/') || rutaArchivo.includes('/Repositories/') ||
      rutaArchivo.includes('/Database/') || rutaArchivo.includes('BaseRepository')) {
    return violaciones;
  }

  const textoCompleto = lineas.join('\n');
  const esControllerRest = /register_rest_route|WP_REST_Response|WP_REST_Request/.test(textoCompleto);
  if (!esControllerRest) { return violaciones; }

  const regexAccesoBd = /(\$this->pg|\$wpdb->(?:query|get_results|get_var|get_row|insert|update|delete|prepare)\s*\(|PostgresService|->ejecutar\()/;

  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i])) { continue; }
    if (tieneSentinelDisable(lineas, i, 'endpoint-accede-bd')) { continue; }
    if (lineas[i].includes('sentinel-disable endpoint-accede-bd')) { continue; }
    if (/\b(START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(lineas[i])) { continue; }

    const match = regexAccesoBd.exec(lineas[i]);
    if (match) {
      violaciones.push({
        reglaId: 'endpoint-accede-bd',
        mensaje: `Query directa en controller/endpoint ('${match[1]}'). Mover logica de datos a un Repository o Service.`,
        severidad: obtenerSeveridadRegla('endpoint-accede-bd'),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[1].length,
        sugerencia: 'Extraer la query a un metodo en el Repository correspondiente.',
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/*
 * Detecta INTERVAL con variable interpolada sin whitelist.
 * PostgreSQL INTERVAL '$variable' se interpola como string, no como parametro PDO.
 */
export function verificarIntervalSinWhitelist(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  const regexInterval = /INTERVAL\s+['"]?\s*[\$\{]/i;
  const regexInterval2 = /INTERVAL\s+'\s*\$/i;
  const regexWhitelist = /\b(in_array|match\s*\(|switch\s*\(|\$validos|\$ventanas|allowedIntervals|intervalosPermitidos|ventanasValidas)\b/i;
  const VENTANA_WHITELIST = 40;

  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i])) { continue; }
    if (tieneSentinelDisable(lineas, i, 'interval-sin-whitelist')) { continue; }
    if (lineas[i].includes('sentinel-disable interval-sin-whitelist')) { continue; }

    if (regexInterval.test(lineas[i]) || regexInterval2.test(lineas[i])) {
      let tieneWhitelist = false;
      const inicioVentana = Math.max(0, i - VENTANA_WHITELIST);
      for (let j = inicioVentana; j < i; j++) {
        if (regexWhitelist.test(lineas[j])) {
          tieneWhitelist = true;
          break;
        }
      }

      if (!tieneWhitelist) {
        violaciones.push({
          reglaId: 'interval-sin-whitelist',
          mensaje: 'INTERVAL con variable interpolada sin whitelist. Vector de inyeccion SQL. Validar con in_array() contra valores permitidos.',
          severidad: obtenerSeveridadRegla('interval-sin-whitelist'),
          linea: i,
          sugerencia: "Agregar whitelist: $validos = ['7 days', '30 days']; if (!in_array($intervalo, $validos, true)) $intervalo = '30 days';",
          fuente: 'estatico',
        });
      }
    }
  }

  return violaciones;
}

/*
 * Detecta wp_redirect() o header('Location:') con variable sin validar.
 * Riesgo de Open Redirect si la URL proviene de input de usuario.
 */
export function verificarOpenRedirect(lineas: string[]): Violacion[] {
  const violaciones: Violacion[] = [];

  const regexWpRedirect = /\bwp_redirect\s*\(\s*\$/;
  const regexHeaderLocation = /\bheader\s*\(\s*['"]Location:\s*['"]?\s*\.\s*\$/i;
  const regexValidacion = /\b(wp_validate_redirect|wp_safe_redirect|esc_url|filter_var\s*\([^,]*,\s*FILTER_VALIDATE_URL)\b/;
  const VENTANA_VALIDACION = 5;

  for (let i = 0; i < lineas.length; i++) {
    if (esComentario(lineas[i])) { continue; }
    if (tieneSentinelDisable(lineas, i, 'open-redirect')) { continue; }
    if (lineas[i].includes('sentinel-disable open-redirect')) { continue; }

    const esRedirectInseguro = regexWpRedirect.test(lineas[i]) || regexHeaderLocation.test(lineas[i]);
    if (!esRedirectInseguro) { continue; }

    if (/\bwp_safe_redirect\b/.test(lineas[i])) { continue; }

    const regexUrlInterna = /\b(wp_login_url|home_url|admin_url|get_permalink|site_url|network_site_url|get_post_permalink|wp_logout_url)\s*\(/;
    if (regexUrlInterna.test(lineas[i])) { continue; }

    /* Verificar si la variable viene de funcion interna segura */
    const matchVar = /wp_redirect\s*\(\s*(\$\w+)/.exec(lineas[i]);
    if (matchVar) {
      const nombreVar = matchVar[1].replace('$', '\\$');
      const regexAsignacionSegura = new RegExp(`${nombreVar}\\s*=\\s*(wp_login_url|home_url|admin_url|get_permalink|site_url|network_site_url|wp_logout_url)\\s*\\(`);
      let origenSeguro = false;
      for (let j = Math.max(0, i - 8); j < i; j++) {
        if (regexAsignacionSegura.test(lineas[j])) {
          origenSeguro = true;
          break;
        }
      }
      if (origenSeguro) { continue; }
    }

    let tieneValidacion = false;
    const inicioVentana = Math.max(0, i - VENTANA_VALIDACION);
    const finVentana = Math.min(lineas.length, i + VENTANA_VALIDACION);
    for (let j = inicioVentana; j < finVentana; j++) {
      if (regexValidacion.test(lineas[j])) {
        tieneValidacion = true;
        break;
      }
    }

    if (!tieneValidacion) {
      violaciones.push({
        reglaId: 'open-redirect',
        mensaje: 'Redireccion con URL no validada. Riesgo de Open Redirect. Usar wp_safe_redirect() o wp_validate_redirect().',
        severidad: obtenerSeveridadRegla('open-redirect'),
        linea: i,
        sugerencia: 'Usar wp_safe_redirect($url) o validar con wp_validate_redirect($url, home_url()).',
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}
