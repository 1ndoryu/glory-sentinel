const SAFE_BRANCH = /^(?!.*(?:\.\.|@\{))(?!.*[~^:?*\[\]\\])(?!.*\/{2})(?!.*\/$)(?!.*\.$)[A-Za-z0-9._\/-]{1,127}$/u;

export function isSafeBranch(value: string): boolean {
  if (!SAFE_BRANCH.test(value)) return false;
  return value.split('/').every(component =>
    component.length > 0
    && !component.startsWith('.')
    && !component.endsWith('.')
    && !component.toLowerCase().endsWith('.lock')
  );
}

export function assertSafeBranch(value: string, label = 'rama principal'): string {
  if (!isSafeBranch(value)) throw new Error(`${label} inválida: ${value}`);
  return value;
}
