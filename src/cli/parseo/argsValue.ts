/* Lectura del valor de una opción. Rechaza un valor ausente o que sea otra
 * opción (--x) para no consumir el flag siguiente como si fuera el valor. */

export function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Falta valor para ${option}`);
  }
  return value;
}
