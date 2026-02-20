/*
 * Prompts de IA para Code Sentinel.
 * Las reglas NO estan hardcodeadas aqui — se inyectan desde el archivo
 * de protocolo del proyecto (.github/instructions o el configurado en settings).
 * Esto permite que las reglas evolucionan sin tocar la extension.
 */

/* Instruccion base: solo define el formato de respuesta esperado */
const PROMPT_BASE = `Eres un auditor de codigo estricto que verifica el cumplimiento de reglas de desarrollo.
Analiza el archivo proporcionado UNICAMENTE contra las reglas del protocolo listadas a continuacion.
No inventes reglas ni apliques convenciones generales que no esten en el protocolo.
Debes usar EXCLUSIVAMENTE los numeros de linea del bloque "CODIGO NUMERADO" para reportar violaciones.
Si una regla depende de conteo total de lineas (ej: archivo-monolito), DEBES usar el valor de "TOTAL_LINEAS_REALES".

Responde SOLO en JSON valido con este formato exacto:

{
  "violaciones": [
    {
      "linea": 42,
      "lineaFin": 45,
      "regla": "id-de-la-regla",
      "severidad": "error",
      "mensaje": "Descripcion clara de la violacion encontrada",
      "sugerencia": "Como corregirlo segun el protocolo"
    }
  ]
}

Severidades validas: "error", "warning", "information", "hint".
Si no hay violaciones, responde exactamente: {"violaciones": []}
NO incluyas texto fuera del JSON. NO uses markdown. NO expliques nada fuera del JSON.`;

/*
 * Construye el prompt completo.
 * Si hay reglas del archivo de protocolo del proyecto, se usan exclusivamente.
 * Si no hay reglas configuradas, el analisis IA se deshabilita con un aviso claro.
 */
export function construirPrompt(tipoArchivo: string, codigoArchivo: string, reglasCustom?: string): string {
  /* Sin reglas del protocolo, no tiene sentido analizar — la IA inventaria reglas */
  const seccionReglas = reglasCustom && reglasCustom.trim().length > 0
    ? `PROTOCOLO DEL PROYECTO (reglas a verificar):\n${reglasCustom}`
    : `PROTOCOLO DEL PROYECTO: No se cargo ningun archivo de reglas. Responde {"violaciones": []} sin analizar.`;

  const totalLineasReales = codigoArchivo.split('\n').length;
  const codigoNumerado = numerarCodigo(codigoArchivo);

  return `${PROMPT_BASE}

${seccionReglas}

TIPO DE ARCHIVO: ${tipoArchivo}

TOTAL_LINEAS_REALES: ${totalLineasReales}

CODIGO NUMERADO (usar estos numeros de linea para el JSON):
\`\`\`
${codigoNumerado}
\`\`\``;
}

/* Numerar lineas para reducir errores de conteo del modelo */
function numerarCodigo(codigoArchivo: string): string {
  const lineas = codigoArchivo.split('\n');
  return lineas
    .map((linea, index) => `${String(index + 1).padStart(4, '0')} | ${linea}`)
    .join('\n');
}
