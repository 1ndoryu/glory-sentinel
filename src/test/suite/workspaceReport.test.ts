import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

async function esperarArchivoActualizado(ruta: string, desde: number): Promise<string> {
  const limite = Date.now() + 120000;

  while (Date.now() < limite) {
    try {
      const stat = await fs.stat(ruta);
      if (stat.mtimeMs >= desde) {
        return await fs.readFile(ruta, 'utf8');
      }
    } catch {
      /* esperar a que el reporte exista */
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error(`El reporte ${ruta} no se actualizo dentro del timeout esperado.`);
}

suite('workspace-report', () => {
  test('genera el reporte del workspace objetivo con las reglas actualizadas', async function () {
    this.timeout(180000);

    const targetWorkspace = process.env.CODE_SENTINEL_TARGET_WORKSPACE;
    if (!targetWorkspace) {
      this.skip();
      return;
    }

    const extension = vscode.extensions.getExtension('1ndoryu.glory-sentinel');
    assert.ok(extension, 'La extension 1ndoryu.glory-sentinel debe estar disponible en el host de pruebas.');
    await extension!.activate();

    const reportPath = path.join(targetWorkspace, '.sentinel-report.md');
    const fechaInicio = Date.now();

    await vscode.commands.executeCommand('codeSentinel.analyzeWorkspace');
    const reporte = await esperarArchivoActualizado(reportPath, fechaInicio);

    assert.ok(reporte.includes('# Code Sentinel - Reporte de Workspace'));
    assert.ok(!reporte.includes('modalBotonPrincipal'));
    assert.ok(!reporte.includes('modalBotonGoogle'));
    assert.ok(!reporte.includes('ctaBotonPrimario'));
    assert.ok(!reporte.includes('ctaBotonSecundario'));
    assert.ok(!reporte.includes('testimoniosBotonEscribir'));
    assert.ok(!reporte.includes('pagoBotonReembolso'));
    assert.ok(!reporte.includes('pagoBotonEnviarReembolso'));
    assert.ok(!reporte.includes('pagoBotonCancelarReembolso'));
    assert.ok(!reporte.includes('reviewBotonResponder'));
    assert.ok(!reporte.includes('reviewBotonEnviar'));
    assert.ok(!reporte.includes('botonMenuMovil'));
    assert.ok(!reporte.includes('botonHeader'));
    assert.ok(!reporte.includes('botonFooter'));
    assert.ok(!reporte.includes('testimonioBotonEnviar'));
  });
});