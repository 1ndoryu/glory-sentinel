/*
 * CodeActionProvider para quick fixes automaticos.
 * Ofrece correcciones rapidas cuando hay diagnosticos de Code Sentinel.
 */

import * as vscode from 'vscode';

const NOMBRE_FUENTE = 'Code Sentinel';

export class SentinelCodeActionProvider implements vscode.CodeActionProvider {

  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  /*
   * Genera code actions (quick fixes) para los diagnosticos de Code Sentinel
   * que estan en el rango del cursor o seleccion.
   */
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostico of context.diagnostics) {
      if (diagnostico.source !== NOMBRE_FUENTE) {
        continue;
      }

      const reglaId = diagnostico.code as string;
      const fix = this.generarFix(document, diagnostico, reglaId);
      if (fix) {
        actions.push(fix);
      }

      /* Siempre ofrecer opcion de ignorar la regla en esta linea */
      const ignorar = this.crearAccionIgnorar(document, diagnostico, reglaId);
      actions.push(ignorar);
    }

    return actions;
  }

  /* Genera el quick fix apropiado segun la regla violada */
  private generarFix(
    document: vscode.TextDocument,
    diagnostico: vscode.Diagnostic,
    reglaId: string
  ): vscode.CodeAction | null {
    switch (reglaId) {
      case 'php-supresor-at':
      case 'at-generico-php':
        return this.fixSupresorAt(document, diagnostico);

      case 'catch-vacio':
        return this.fixCatchVacio(document, diagnostico);

      case 'limite-lineas':
        return this.fixLimiteLineas(document, diagnostico);

      case 'import-muerto':
        return this.fixImportMuerto(document, diagnostico);

      case 'css-inline-jsx':
        return this.fixCssInline(document, diagnostico);

      default:
        return null;
    }
  }

  /* Fix: Reemplazar @funcion() con try-catch */
  private fixSupresorAt(
    document: vscode.TextDocument,
    diagnostico: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'Reemplazar @ con try-catch',
      vscode.CodeActionKind.QuickFix
    );

    const lineaTexto = document.lineAt(diagnostico.range.start.line).text;
    const indentacion = lineaTexto.match(/^\s*/)?.[0] || '';

    /* Extraer la llamada a funcion sin el @ */
    const sinAt = lineaTexto.replace(/@(\w+\s*\()/, '$1');

    const edit = new vscode.WorkspaceEdit();
    const rangoLinea = document.lineAt(diagnostico.range.start.line).range;
    const reemplazo = `${indentacion}try {\n${indentacion}    ${sinAt.trim()}\n${indentacion}} catch (\\Throwable $e) {\n${indentacion}    error_log('[Code Sentinel] Error: ' . $e->getMessage());\n${indentacion}}`;

    edit.replace(document.uri, rangoLinea, reemplazo);
    action.edit = edit;
    action.diagnostics = [diagnostico];
    action.isPreferred = true;

    return action;
  }

  /* Fix: Llenar catch vacio con logging */
  private fixCatchVacio(
    document: vscode.TextDocument,
    diagnostico: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'Agregar logging al catch vacio',
      vscode.CodeActionKind.QuickFix
    );

    const lineaInicio = diagnostico.range.start.line;
    const texto = document.getText(diagnostico.range);
    const indentacion = document.lineAt(lineaInicio).text.match(/^\s*/)?.[0] || '';

    /* Detectar si es PHP o JS/TS */
    const esPhp = document.languageId === 'php';
    const varExcepcion = texto.match(/catch\s*\(([^)]+)\)/)?.[1] || (esPhp ? '\\Throwable $e' : 'error');
    const varNombre = esPhp
      ? (varExcepcion.includes('$') ? varExcepcion.split('$').pop() : 'e')
      : varExcepcion;

    let logging: string;
    if (esPhp) {
      logging = `error_log('[Error] ' . $${varNombre}->getMessage());`;
    } else {
      logging = `console.error('[Error]', ${varNombre});`;
    }

    const edit = new vscode.WorkspaceEdit();

    /* Buscar las llaves vacias del catch */
    const catchMatch = texto.match(/catch\s*\([^)]*\)\s*\{(\s*)\}/);
    if (catchMatch) {
      const reemplazo = texto.replace(
        /catch\s*\([^)]*\)\s*\{\s*\}/,
        `catch (${varExcepcion}) {\n${indentacion}    ${logging}\n${indentacion}}`
      );
      edit.replace(document.uri, diagnostico.range, reemplazo);
    }

    action.edit = edit;
    action.diagnostics = [diagnostico];
    action.isPreferred = true;

    return action;
  }

  /* Fix: Marcar archivo con TO-DO de division */
  private fixLimiteLineas(
    document: vscode.TextDocument,
    diagnostico: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'Agregar TO-DO: dividir archivo',
      vscode.CodeActionKind.QuickFix
    );

    const edit = new vscode.WorkspaceEdit();
    const posicion = new vscode.Position(0, 0);
    const comentario = document.languageId === 'php'
      ? `<?php\n/* TO-DO: dividir archivo - excede limite de lineas */\n`
      : `/* TO-DO: dividir archivo - excede limite de lineas */\n`;

    /* No agregar si ya existe */
    const primerasLineas = document.getText(new vscode.Range(0, 0, 3, 0));
    if (!primerasLineas.includes('TO-DO: dividir archivo')) {
      edit.insert(document.uri, posicion, comentario);
    }

    action.edit = edit;
    action.diagnostics = [diagnostico];

    return action;
  }

  /* Fix: Eliminar import muerto */
  private fixImportMuerto(
    document: vscode.TextDocument,
    diagnostico: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'Eliminar import sin uso',
      vscode.CodeActionKind.QuickFix
    );

    const edit = new vscode.WorkspaceEdit();
    const linea = diagnostico.range.start.line;
    const rangoLinea = new vscode.Range(linea, 0, linea + 1, 0);
    edit.delete(document.uri, rangoLinea);

    action.edit = edit;
    action.diagnostics = [diagnostico];
    action.isPreferred = true;

    return action;
  }

  /* Fix: Comentar CSS inline con sugerencia */
  private fixCssInline(
    document: vscode.TextDocument,
    diagnostico: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'Marcar TO-DO: extraer a archivo CSS',
      vscode.CodeActionKind.QuickFix
    );

    const edit = new vscode.WorkspaceEdit();
    const linea = diagnostico.range.start.line;
    const indentacion = document.lineAt(linea).text.match(/^\s*/)?.[0] || '';

    edit.insert(
      document.uri,
      new vscode.Position(linea, 0),
      `${indentacion}{/* TO-DO: extraer estilos inline a archivo .css */}\n`
    );

    action.edit = edit;
    action.diagnostics = [diagnostico];

    return action;
  }

  /* Genera accion para ignorar una regla en una linea especifica */
  private crearAccionIgnorar(
    document: vscode.TextDocument,
    diagnostico: vscode.Diagnostic,
    reglaId: string
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `Ignorar "${reglaId}" en esta linea`,
      vscode.CodeActionKind.QuickFix
    );

    const edit = new vscode.WorkspaceEdit();
    const linea = diagnostico.range.start.line;
    const indentacion = document.lineAt(linea).text.match(/^\s*/)?.[0] || '';

    const comentario = document.languageId === 'php'
      ? `${indentacion}/* sentinel-disable-next-line ${reglaId} */\n`
      : `${indentacion}/* sentinel-disable-next-line ${reglaId} */\n`;

    edit.insert(document.uri, new vscode.Position(linea, 0), comentario);

    action.edit = edit;
    action.diagnostics = [diagnostico];

    return action;
  }
}
