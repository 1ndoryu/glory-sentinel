/*
 * [318A-4] Regla formulario-config-sin-sistema-declarativo (plan 318A-3 §14).
 * Detecta archivos (ModalConfig|SeccionConfig|Config)*.tsx que NO importan el sistema
 * declarativo (FormCampo/FormularioConfiguracion/CampoEspecificacion) y que contienen
 * >=3 campos de formulario nativos (<input|<select|<textarea|<button en minusculas;
 * los componentes Input/Select/Textarea/Boton del sistema NO cuentan — patrón twin-class §12.2).
 * Un solo hallazgo por archivo (accionable: migrar al sistema).
 *
 * Modulo propio (split 0.7.6) para mantener reactComponentRules.ts dentro del
 * budget de scripts/module-budgets.json.
 */

import { Violacion } from '../../types';
import { esComentario, tieneSentinelDisable } from '../../utils/analisisHelpers';
import { obtenerSeveridadRegla } from '../../config/ruleRegistry';

export function verificarFormularioConfigSinSistema(lineas: string[], nombreArchivo: string): Violacion[] {
  if (!/\.(tsx|jsx)$/.test(nombreArchivo)) { return []; }

  const nombreBase = nombreArchivo.replace(/\.(tsx|jsx)$/, '');
  if (!/^(ModalConfig|SeccionConfig|Config)/.test(nombreBase)) { return []; }
  if (nombreArchivo.includes('.test.') || nombreArchivo.includes('.spec.')) { return []; }

  const texto = lineas.join('\n');
  /* Disable-file especifico de la regla o disable-file generico (desactiva todo). */
  if (texto.includes('sentinel-disable-file formulario-config-sin-sistema-declarativo')) { return []; }
  if (/sentinel-disable-file[\s*:]*$/.test(texto)) { return []; }

  /* Los archivos del propio sistema declarativo nunca se auto-flaggean. */
  if (['FormCampo', 'FormularioConfiguracion', 'CampoEspecificacion', 'ItemToggle', 'ToggleSwitch'].includes(nombreBase)) { return []; }

  /* Import del sistema declarativo en las primeras 80 lineas => ya es parte del sistema. */
  const cabecera = lineas.slice(0, Math.min(80, lineas.length)).join('\n');
  if (/\bimport\b[^;]*(?:FormCampo|FormularioConfiguracion|CampoEspecificacion)/.test(cabecera)) { return []; }
  if (/require\s*\([^)]*(?:FormCampo|FormularioConfiguracion|CampoEspecificacion)/.test(cabecera)) { return []; }

  let campos = 0;
  let primerCampo = -1;
  /* Solo etiquetas nativas en minusculas: los componentes del sistema (Input/Select/
     Textarea/Boton) ya son el patron twin-class aceptado (plan 318A-3 §12.2), no campos nativos. */
  const patronCampo = /<\s*(?:input|select|textarea|button)[\s/>]/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentario(linea)) { continue; }
    if (tieneSentinelDisable(lineas, i, 'formulario-config-sin-sistema-declarativo')) { continue; }
    if (linea.includes('sentinel-disable formulario-config-sin-sistema-declarativo')) { continue; }
    if (patronCampo.test(linea)) {
      campos++;
      if (primerCampo === -1) { primerCampo = i; }
    }
  }

  if (campos < 3) { return []; }

  return [{
    reglaId: 'formulario-config-sin-sistema-declarativo',
    mensaje: 'Formulario de configuración manual (' + campos + ' campos nativos) sin FormCampo/FormularioConfiguracion. Migrar al sistema declarativo (components/shared).',
    severidad: obtenerSeveridadRegla('formulario-config-sin-sistema-declarativo'),
    linea: primerCampo,
    fuente: 'estatico',
  }];
}