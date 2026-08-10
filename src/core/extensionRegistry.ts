/* [108A-1 Fase 2] Registro de extensiones del producto único Sentinel.
 *
 * Una extensión es toda regla/analyzer/plugin declarado fuera del núcleo
 * agnóstico (o un plugin publicado). El registro impone el contrato del
 * producto:
 *   - identidad estable, owner, rule IDs productivos, entrypoint, fixtures,
 *     presupuestos y condición de retirada declarados;
 *   - una regla, un dueño: sin colisiones de rule IDs entre extensiones ni
 *     contra las reglas built-in del núcleo (ruleRegistry es la fuente de las
 *     reglas del núcleo);
 *   - rechazo de extensiones ejecutables no declaradas: todo binario que
 *     quiera producir findings debe estar registrado con entrypoint.
 *
 * Es un módulo PURO (sin I/O): la existencia física de entrypoints/fixtures
 * la verifica el caller (doctor/check). Mantenerlo sin imports del editor
 * garantiza que `check:core` no lo bloquee y que el gate pueda usarlo. */
import { obtenerIdsReglas } from '../config/ruleRegistry';

export interface ExtensionRegistration {
  /** Identidad estable y única (p. ej. 'varsense', 'glory-api'). */
  id: string;
  /** Owner del proyecto (persona/equipo responsable de la regla). */
  owner: string;
  /** Rule IDs productivos que publica esta extensión. */
  ruleIds: string[];
  /** Entrypoint ejecutable declarado, ruta relativa al árbol. */
  entrypoint?: string;
  /** Fixtures de paridad que la respaldan. */
  fixtures?: string[];
  /** Presupuestos declarados (ms, bytes...), clave = métrica. */
  budgets?: Record<string, number>;
  /** Condición de retirada: cuándo se puede dar de baja (texto auditado). */
  retirementCondition?: string;
}

export interface RegistryValidation {
  extensionIds: string[];
  /** ruleId → id de la extensión dueña (dueño único garantizado). */
  ruleOwners: Map<string, string>;
}

const IDENTIDAD_VALIDA = /^[a-z0-9][a-z0-9._-]*$/u;

/** Valida el registro completo y lanza con el primer incumplimiento:
 * identidad/owner ausentes o inválidos, identidades duplicadas, colisiones de
 * rule IDs (entre extensiones o contra el núcleo) y entrypoints absolutos. */
export function validateExtensionRegistry(
  extensions: ExtensionRegistration[],
  builtinRuleIds: ReadonlySet<string> = obtenerIdsReglas(),
): RegistryValidation {
  const ruleOwners = new Map<string, string>();
  const extensionIds = new Set<string>();
  for (const extension of extensions) {
    if (!IDENTIDAD_VALIDA.test(extension.id)) {
      throw new Error(`extensión sin identidad válida: ${String(extension.id)}`);
    }
    if (extensionIds.has(extension.id)) {
      throw new Error(`identidad de extensión duplicada: ${extension.id}`);
    }
    extensionIds.add(extension.id);
    if (!extension.owner || extension.owner.trim().length === 0) {
      throw new Error(`extensión ${extension.id} sin owner declarado`);
    }
    if (!Array.isArray(extension.ruleIds) || extension.ruleIds.length === 0) {
      throw new Error(`extensión ${extension.id} sin rule IDs productivos`);
    }
    for (const ruleId of extension.ruleIds) {
      if (!ruleId || ruleId.trim().length === 0) {
        throw new Error(`extensión ${extension.id} declara un rule ID vacío`);
      }
      if (builtinRuleIds.has(ruleId)) {
        throw new Error(`colisión de rule ID con el núcleo: ${ruleId} (extensión ${extension.id})`);
      }
      const owner = ruleOwners.get(ruleId);
      if (owner !== undefined && owner !== extension.id) {
        throw new Error(`colisión de rule ID: ${ruleId} declarado por ${owner} y ${extension.id}`);
      }
      ruleOwners.set(ruleId, extension.id);
    }
    if (extension.entrypoint !== undefined && !extension.entrypoint.startsWith('.')) {
      throw new Error(`extensión ${extension.id}: entrypoint debe ser una ruta relativa`);
    }
  }
  return { extensionIds: [...extensionIds].sort(), ruleOwners };
}

/** Rechaza extensiones ejecutables no declaradas: toda ruta ejecutable que
 * exista en el árbol (lista provista por el caller, que hace la I/O) debe
 * estar declarada como entrypoint de alguna extensión registrada. */
export function assertNoUndeclaredExecutables(
  extensions: ExtensionRegistration[],
  declaredExecutablePaths: string[],
): void {
  for (const executable of declaredExecutablePaths) {
    const declared = extensions.some(extension => extension.entrypoint === executable);
    if (!declared) {
      throw new Error(`extensión ejecutable no declarada en el registro: ${executable}`);
    }
  }
}
