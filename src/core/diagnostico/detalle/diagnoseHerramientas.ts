/* [108A-1 Fase 4] Diagnóstico de las herramientas declaradas en
 * quality-tools.json: origen, checkout, CLI, dependencias, gitlink, release y
 * coherencia con sentinel.lock.json. Solo lectura. */
import { access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { checkoutChanges, checkoutCommit, releaseRefs, stagedSubmoduleCommit, submoduleCommit } from './diagnoseGit';
import { cliCapabilities, cliVersion, packageMetadata, readJsonFile, releaseEvidence } from './diagnoseSonda';
import type { DiagnoseIssue, DiagnoseTool } from './diagnoseTipos';

function toolConfig(manifest: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const value = manifest[name];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function resolveSourcePath(root: string, config: Record<string, unknown> | null): string | null {
  const sourcePath = config?.sourcePath;
  if (typeof sourcePath === 'string' && sourcePath.length > 0) return path.resolve(root, sourcePath);
  const sourcePathEnv = config?.sourcePathEnv;
  if (typeof sourcePathEnv === 'string' && /^GLORY_[A-Z0-9_]+$/u.test(sourcePathEnv)) {
    const value = process.env[sourcePathEnv];
    return typeof value === 'string' && value.length > 0 ? path.resolve(value) : null;
  }
  return null;
}

function insideWorkspace(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function diagnoseConfiguredTools(root: string, lockData: Record<string, unknown> | null): Promise<{ tools: Record<string, DiagnoseTool>; issues: DiagnoseIssue[] }> {
  const manifest = await readJsonFile(path.join(root, 'quality-tools.json')) as { tools?: unknown } | null;
  /* [108A-1 Fase 4] Sin quality-tools.json NO es un problema: un proyecto
   * iniciado con `sentinel init` reduce el contrato a sentinel.config.json +
   * sentinel.lock.json (la metadata de tools pasa a generación interna bajo
   * .sentinel/). La verificación de tools aplica solo si están declaradas;
   * un manifest presente pero inválido sí falla. */
  if (!manifest || !manifest.tools || typeof manifest.tools !== 'object' || Array.isArray(manifest.tools)) {
    if (!manifest) return { tools: {}, issues: [] };
    return { tools: {}, issues: [{ code: 'tools-manifest-missing', message: 'quality-tools.json no contiene tools verificables' }] };
  }
  const configuredTools = manifest.tools as Record<string, unknown>;
  const lockAnalyzers = lockData?.analyzers && typeof lockData.analyzers === 'object' && !Array.isArray(lockData.analyzers)
    ? lockData.analyzers as Record<string, unknown>
    : {};
  const tools: Record<string, DiagnoseTool> = {};
  const issues: DiagnoseIssue[] = [];
  for (const name of Object.keys(configuredTools)) {
    const config = toolConfig(configuredTools, name);
    const configuredSourcePath = resolveSourcePath(root, config);
    const sourceRealPath = configuredSourcePath ? await realpath(configuredSourcePath).catch(() => null) : null;
    const sourceEscapesWorkspace = Boolean(
      configuredSourcePath
      && sourceRealPath
      && insideWorkspace(root, configuredSourcePath)
      && !insideWorkspace(root, sourceRealPath),
    );
    const configuredProvisionPath = typeof config?.provisionPath === 'string' ? path.resolve(root, config.provisionPath) : null;
    const sourcePath = sourceEscapesWorkspace ? null : configuredSourcePath;
    const provisionPath = sourceEscapesWorkspace ? null : configuredProvisionPath;
    const toolRoot = provisionPath ?? sourcePath;
    const sourceExternal = sourceRealPath ? !insideWorkspace(root, sourceRealPath) : Boolean(sourcePath && !insideWorkspace(root, sourcePath));
    const lockEntry = lockAnalyzers[name] && typeof lockAnalyzers[name] === 'object' && !Array.isArray(lockAnalyzers[name])
      ? lockAnalyzers[name] as Record<string, unknown>
      : null;
    const configuredCommit = typeof config?.commit === 'string' ? config.commit : null;
    const configuredVersion = typeof config?.version === 'string' ? config.version : null;
    const lockVersion = typeof lockEntry?.version === 'string' ? lockEntry.version : null;
    const cli = typeof config?.cli === 'string' && toolRoot ? path.resolve(toolRoot, config.cli) : null;
    const cliRealPath = cli ? await realpath(cli).catch(() => null) : null;
    const cliInsideSource = Boolean(
      sourcePath
      && cli
      && (cliRealPath ?? cli)
      && insideWorkspace(toolRoot ?? sourcePath ?? root, cliRealPath ?? cli),
    );
    let sourcePresent = false;
    let cliPresent = false;
    let actualCommit: string | null = null;
    let dirty = false;
    let changes: string[] = [];
    if (sourcePath) {
      try { await access(sourcePath); sourcePresent = true; } catch { sourcePresent = false; }
      if (sourcePresent) {
        actualCommit = await checkoutCommit(sourcePath);
        changes = actualCommit ? await checkoutChanges(sourcePath) : ['<git-checkout-unavailable>'];
        dirty = changes.length > 0;
      }
      if (cli) {
        try { await access(cli); cliPresent = true; } catch { cliPresent = false; }
      }
    }
    const reportedVersion = await cliVersion(cliPresent ? cli : null);
    const capabilities = await cliCapabilities(cliPresent ? cli : null);
    const metadata = await packageMetadata(toolRoot, config);
    const configuredReleaseRefs = Array.isArray(config?.releaseRefs)
      ? config.releaseRefs.filter((value): value is string => typeof value === 'string')
      : [];
    const publishedRefs = sourcePath && actualCommit ? await releaseRefs(sourcePath, actualCommit, configuredReleaseRefs) : [];
    const releaseEvidencePresent = await releaseEvidence(
      root,
      name,
      actualCommit,
      typeof config?.testScript === 'string' ? config.testScript : null,
    );
    const requiredCapabilities = Array.isArray(config?.requiredCapabilities)
      ? config.requiredCapabilities.filter((value): value is string => typeof value === 'string')
      /* [108A-1 Fase 2] El análisis y el gate son el núcleo del producto
       * (analyze/check/doctor/status). `task`, `recover` y los shims son
       * capabilities OPCIONALES: su ausencia no debe bloquear el doctor de un
       * checkout que solo corre `sentinel check` sin orquestación. */
      : (name === 'sentinel' ? ['analyze', 'check', 'doctor', 'status'] : []);
    const optionalCapabilities = name === 'sentinel' ? ['task', 'recover'] : [];
    /* sourcePath interno no admite patch local (setup lo rechaza); cualquier
     * cambio distinto de la metadata administrativa es inesperado. */
    const unexpectedChanges = changes.filter(change => change !== '.quality-install.json');
    const relativeSource = sourcePath && insideWorkspace(root, sourcePath)
      ? path.relative(root, sourcePath).replace(/\\/g, '/')
      : null;
    const gitlinkCommit = relativeSource ? await submoduleCommit(root, relativeSource) : null;
    const stagedGitlinkCommit = relativeSource ? await stagedSubmoduleCommit(root, relativeSource) : null;
    const lockCommit = typeof lockEntry?.commit === 'string' ? lockEntry.commit : null;
    const diagnostic: DiagnoseTool = {
      name,
      commit: actualCommit,
      sourcePath,
      provisionPath,
      sourceExternal,
      cliPath: cli,
      cliVersion: reportedVersion,
      configuredVersion,
      lockVersion,
      configuredCommit,
      gitlinkCommit,
      stagedGitlinkCommit,
      checkoutCommit: actualCommit,
      lockCommit,
      sourcePresent,
      cliPresent,
      cliResponds: Boolean(reportedVersion),
      cliCapabilities: capabilities,
      missingCapabilities: requiredCapabilities.filter(capability => !capabilities.includes(capability)),
      optionalCapabilities,
      packagePresent: metadata.packagePresent,
      packageLockPresent: metadata.packageLockPresent,
      dependenciesPresent: metadata.dependenciesPresent,
      requiredScripts: metadata.requiredScripts,
      missingScripts: metadata.missingScripts,
      releaseRefs: publishedRefs,
      releaseReachable: publishedRefs.length > 0,
      releaseEvidencePresent,
      checkoutDirty: dirty,
      checkoutChanges: changes,
      unexpectedChanges,
    };
    tools[name] = diagnostic;
    const issue = (code: string, message: string) => issues.push({ code, message, tool: name });
    if (!config) issue('tool-config-invalid', `${name}: configuración ausente o inválida`);
    if (sourceEscapesWorkspace) issue('tool-source-escape', `${name}: sourcePath resuelve mediante symlink/junction fuera del workspace`);
    if (!sourcePath || !sourcePresent) issue('tool-source-missing', `${name}: sourcePath no está inicializado o no existe`);
    if (sourcePresent && !actualCommit) issue('tool-checkout-invalid', `${name}: no es un checkout Git resoluble`);
    if (!cliPresent) issue('tool-cli-missing', `${name}: falta el CLI compilado (${config?.cli ?? 'cli no declarado'})`);
    else if (!reportedVersion) issue('tool-cli-unresponsive', `${name}: el CLI no responde a --version`);
    if (cli && !cliInsideSource) issue('tool-cli-escape', `${name}: el CLI queda fuera del checkout físico de sourcePath`);
    if (sourcePresent && !metadata.packagePresent) issue('tool-package-missing', `${name}: falta package.json`);
    if (sourcePresent && !metadata.packageLockPresent) issue('tool-package-lock-missing', `${name}: falta package-lock.json reproducible`);
    if (sourcePresent && !metadata.dependenciesPresent) issue('tool-dependencies-missing', `${name}: node_modules no está provisionado`);
    for (const script of metadata.missingScripts) issue('tool-script-missing', `${name}: falta el script requerido '${script}' en package.json`);
    for (const capability of diagnostic.missingCapabilities) issue('tool-capability-missing', `${name}: capacidad no instalada: ${capability}`);
    if (sourcePresent && actualCommit && unexpectedChanges.some(change => /(^|\/)package-lock\.json$/u.test(change))) {
      issue('tool-package-lock-dirty', `${name}: package-lock.json modificado; instalación interrumpida o lock no reproducible`);
    }
    if (sourcePresent && actualCommit && dirty && unexpectedChanges.length > 0) issue('tool-checkout-dirty', `${name}: checkout modificado; cambios no declarados: ${unexpectedChanges.join(', ')}`);
    if (sourcePresent && actualCommit && !diagnostic.releaseReachable) issue('tool-release-unpublished', `${name}: commit ${actualCommit} no es alcanzable desde una ref de release permitida`);
    if (sourcePresent && actualCommit && !releaseEvidencePresent) issue('tool-release-evidence-missing', `${name}: falta evidencia compile + suite desde staging limpio para ${actualCommit}; ejecuta npm run quality:setup`);
    if (!configuredCommit) issue('tool-config-commit-missing', `${name}: falta el commit fijado en quality-tools.json`);
    if (!lockEntry) issue('tool-lock-entry-missing', `${name}: falta analyzers.${name} en sentinel.lock.json`);
    if (sourcePresent && relativeSource && !gitlinkCommit) {
      if (stagedGitlinkCommit) {
        issue('tool-gitlink-uncommitted', `${name}: el gitlink está preparado en el índice (${stagedGitlinkCommit.slice(0, 12)}), pero aún no está committeado en HEAD; committea el pin antes del lock/gate`);
      } else {
        issue('tool-gitlink-missing', `${name}: sourcePath interno no está representado por un gitlink en HEAD; inicializa el submódulo y committea el pin antes del lock/gate`);
      }
    }
    if (configuredCommit && gitlinkCommit && configuredCommit !== gitlinkCommit) issue('tool-gitlink-mismatch', `${name}: quality-tools.json no coincide con el gitlink`);
    if (configuredCommit && actualCommit && configuredCommit !== actualCommit) issue('tool-checkout-mismatch', `${name}: checkout no coincide con quality-tools.json`);
    if (configuredCommit && configuredCommit !== lockCommit) issue('tool-lock-mismatch', `${name}: sentinel.lock.json no coincide con quality-tools.json`);
    if (configuredVersion && configuredVersion !== lockVersion) issue('tool-lock-version-mismatch', `${name}: sentinel.lock.json version does not match quality-tools.json`);
    if (configuredVersion && reportedVersion && configuredVersion !== reportedVersion) issue('tool-version-mismatch', `${name}: CLI reporta ${reportedVersion}, se esperaba ${configuredVersion}`);
    if (actualCommit && actualCommit !== lockCommit) issue('tool-installed-mismatch', `${name}: checkout instalado no coincide con sentinel.lock.json`);
  }
  return { tools, issues };
}
