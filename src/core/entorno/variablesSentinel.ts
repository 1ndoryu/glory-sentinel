/* [S-R1] Nombres canónicos SENTINEL_* de las variables de entorno del runtime.
 * Los GLORY_QUALITY_* de versiones anteriores siguen funcionando: al leer uno
 * se avisa una vez por proceso, y el gate escribe ambos nombres para que las
 * herramientas de versiones anteriores sigan viendo su variable. */

const LEGADA_DE: Readonly<Record<string, string>> = {
  SENTINEL_GATE_TOKEN: 'GLORY_QUALITY_GATE_TOKEN',
  SENTINEL_GATE_LEASE: 'GLORY_QUALITY_GATE_LEASE',
  SENTINEL_GATE_LEASE_TTL_MS: 'GLORY_QUALITY_GATE_LEASE_TTL_MS',
  SENTINEL_PROFILE: 'GLORY_QUALITY_PROFILE',
  SENTINEL_ALLOW_HEAVY: 'GLORY_QUALITY_ALLOW_HEAVY',
};

const avisadas = new Set<string>();

/* Valor de una variable canónica. Gana el nombre SENTINEL_*; si falta, se usa
 * el GLORY_QUALITY_* equivalente y se avisa una vez por proceso. */
export function leerEntornoSentinel(env: NodeJS.ProcessEnv, canonica: string): string | undefined {
  const valor = env[canonica];
  if (valor !== undefined) return valor;
  const legada = LEGADA_DE[canonica];
  if (!legada) return undefined;
  const valorLegado = env[legada];
  if (valorLegado !== undefined && !avisadas.has(legada)) {
    avisadas.add(legada);
    process.stderr.write(`[glory-sentinel] aviso: ${legada} está obsoleta; usa ${canonica}.\n`);
  }
  return valorLegado;
}

/* Escribe el valor en el nombre canónico y en el antiguo, para que lo vean
 * tanto el runtime nuevo como herramientas de versiones anteriores. Devuelve
 * la función que deja el entorno exactamente como estaba. */
export function fijarEntornoSentinel(env: NodeJS.ProcessEnv, canonica: string, valor: string): () => void {
  const nombres = [canonica, LEGADA_DE[canonica]].filter((nombre): nombre is string => Boolean(nombre));
  const previos = nombres.map(nombre => [nombre, env[nombre]] as const);
  for (const nombre of nombres) env[nombre] = valor;
  return () => {
    for (const [nombre, previo] of previos) {
      if (previo === undefined) delete env[nombre];
      else env[nombre] = previo;
    }
  };
}
