/* sentinel-disable-file todo-pendiente todo-prosa-sin-marcador: archivo de muestras del detector de TODO; los marcadores son texto de prueba. */
/* [289A-1] todo-prosa-sin-marcador: migrada desde VarSense
 * (TodoProsaSinMarcador [149A-1 F3.13]). Paridad de guardas 0 FP. */
import * as assert from 'assert';
import { createCoreDocument } from '../../core/runtime-proyecto/types';
import { verificarTodoProsaSinMarcador } from '../../analyzers/static/staticCodeRules';
import {
  configurarOverridesReglas,
  invalidarRegistroReglas,
  obtenerSeveridadRegla,
  reglaHabilitada,
} from '../../config/ruleRegistry';

function docTs(fileName: string, content: string) {
  return createCoreDocument({ uri: `file://${fileName}`, fileName, languageId: 'typescript', content });
}

function verificar(content: string) {
  return verificarTodoProsaSinMarcador(content, docTs('/repo/x.ts', content));
}

suite('289A-1 todo-prosa-sin-marcador: registro', () => {
  test('existe, habilitada por defecto y severidad warning (paridad VarSense)', () => {
    assert.strictEqual(reglaHabilitada('todo-prosa-sin-marcador'), true);
    assert.strictEqual(obtenerSeveridadRegla('todo-prosa-sin-marcador'), 'warning');
  });
});

suite('289A-1 todo-prosa-sin-marcador: positivos', () => {
  test('marca mencion informal en //', () => {
    const v = verificar('// todo revisar esto cuando haya tiempo');
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].reglaId, 'todo-prosa-sin-marcador');
    assert.strictEqual(v[0].linea, 0);
    assert.strictEqual(v[0].columna, 3);
    assert.strictEqual(v[0].fuente, 'estatico');
  });

  test('marca TODO mayusculo sin dos puntos (taquigrafia de tarea)', () => {
    const v = verificar('// TODO migrar a roadmap');
    assert.strictEqual(v.length, 1);
  });

  test('marca en bloque /* */', () => {
    const v = verificar('/* todo sin marcar */\nconst a = 1;');
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].linea, 0);
  });

  test('marca en segunda linea con posicion correcta', () => {
    /* OJO paridad VarSense: "todo" al final del comentario en minusculas es
     * cuantificador y NO marca; la mencion debe ir seguida de mas texto. */
    const v = verificar('const a = 1;\n// todo revisar esto cuando haya tiempo');
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].linea, 1);
    assert.strictEqual(v[0].columna, 3);
  });

  test('TODO solo en mayusculas marca; en minusculas es cuantificador y no marca', () => {
    /* [149A-1 F3.13-H11]: "TODO" solo marca porque se exige TODO: con dos
     * puntos; "todo" solo al final es el cuantificador español. */
    assert.strictEqual(verificar('// TODO').length, 1);
    assert.strictEqual(verificar('// todo').length, 0);
  });
});

suite('289A-1 todo-prosa-sin-marcador: marcadores validos no marcan', () => {
  test('TODO: / TODO() / TODO[] no marcan', () => {
    assert.strictEqual(verificar('// TODO: migrar a roadmap').length, 0);
    assert.strictEqual(verificar('// TODO(revisar) esto').length, 0);
    assert.strictEqual(verificar('// TODO[pm] esto').length, 0);
  });

  test('FIXME y XXX nunca marcan', () => {
    assert.strictEqual(verificar('// FIXME roto').length, 0);
    assert.strictEqual(verificar('// XXX revisar').length, 0);
  });
});

suite('289A-1 todo-prosa-sin-marcador: guardas prosa española', () => {
  test('articulo despues (todo el/la/los…) no marca', () => {
    /* OJO paridad VarSense: la guarda es la palabra SIGUIENTE a "todo"; "todo
     * en el VPS" SI marca (siguiente = "en"); solo el/la/los/las/lo eximen. */
    assert.strictEqual(verificar('// todo el historial de mensajes').length, 0);
    assert.strictEqual(verificar('/* Escanear todo el proyecto */').length, 0);
    assert.strictEqual(verificar('// Revisar todo lo demas manana').length, 0);
  });

  test('cuantificador final minusculo no marca', () => {
    assert.strictEqual(verificar('// re-parsear todo.').length, 0);
  });

  test('todo seguido de conjuncion y/o (cuantificador) no marca', () => {
    /* Falso positivo real: services/marketplace.rs "se descarta todo y va el minimo". */
    assert.strictEqual(verificar('/// P1 trae precio; se descarta todo y va el minimo.').length, 0);
    assert.strictEqual(verificar('// aceptar todo o nada').length, 0);
  });

  test('todo seguido de verbo cuantificador (queda/va/es) no marca', () => {
    /* Falso positivo real: services/marketplace.rs "...todo queda `false`". */
    assert.strictEqual(verificar('/// Si falla, todo queda `false` (el panel jamas se bloquea).').length, 0);
    assert.strictEqual(verificar('// si no, todo es nulo').length, 0);
  });

  test('TODO en mayusculas seguido de y sigue marcando (taquigrafia de tarea)', () => {
    assert.strictEqual(verificar('// TODO y migrar a roadmap').length, 1);
    assert.strictEqual(verificar('// TODO queda por revisar').length, 1);
  });

  test('compuesto con guion no marca', () => {
    assert.strictEqual(verificar('// ver el todo-list del sprint').length, 0);
  });

  test('cuantificador a mitad de frase no marca', () => {
    /* Falso positivo real: CabeceraModal.tsx "…encima del titulo, todo
     * centrado)." El marcador informal abre el comentario o su linea. */
    assert.strictEqual(verificar(' * Variantes: fila (icono al lado),\n * centrada (icono encima del titulo, todo centrado).').length, 0);
    assert.strictEqual(verificar('// el panel queda todo centrado').length, 0);
  });

  test('la mencion que abre el comentario o su linea si marca', () => {
    assert.strictEqual(verificar('/* bloque\n * todo revisar el adapter\n */').length, 1);
    assert.strictEqual(verificar('// todo revisar el adapter').length, 1);
  });

  test('TODO mayusculo a mitad de frase sigue marcando', () => {
    assert.strictEqual(verificar('// el adapter TODO migrar a roadmap').length, 1);
  });

  test('URL con /todo no marca', () => {
    assert.strictEqual(verificar('// ver https://ejemplo.com/todo para detalles').length, 0);
  });

  test('prosa dentro de strings no marca (literales enmascarados)', () => {
    assert.strictEqual(verificar('const s = "todo pendiente"; // comentario limpio').length, 0);
  });

  test('[17AA-4] "todo" en minusculas solo marca si le sigue un infinitivo', () => {
    /* Falso positivo real: `scripts/dev/doctor.mjs:1630` ("* todo verde = 0;
     * dependencia caida/rehusada = 2"). El cuantificador espanol va seguido de
     * sustantivo o adjetivo; el marcador informal, de verbo. */
    const bloque = '/*\n * Asegura `requiere`:\n * todo verde = 0; dependencia caida = 2 (degradado, visible). */';
    assert.strictEqual(verificar(bloque).length, 0);
    assert.strictEqual(verificar('// todo pendiente de decidir').length, 0);
    assert.strictEqual(verificar('// todo listo').length, 0);
  });

  test('[17AA-4] testigo: el mismo "todo" con infinitivo si marca', () => {
    assert.strictEqual(verificar('/*\n * Asegura `requiere`:\n * todo revisar el adapter */').length, 1);
    assert.strictEqual(verificar('// todo arreglar el doctor').length, 1);
    assert.strictEqual(verificar('// todo unificar los dos caminos').length, 1);
    assert.strictEqual(verificar('// todo ver esto').length, 1);
    assert.strictEqual(verificar('// todo ser mas explicito').length, 1);
  });

  test('[17AA-4] el infinitivo detras de preposicion sigue marcando', () => {
    assert.strictEqual(verificar('/* todo sin marcar */\nconst a = 1;').length, 1);
    assert.strictEqual(verificar('// todo por revisar').length, 1);
    assert.strictEqual(verificar('// todo para arreglar').length, 1);
    /* Guarda: "todo sin" sin infinitivo detras no es una tarea. */
    assert.strictEqual(verificar('// todo sin sentido').length, 0);
  });

  test('[17AA-4] en mayusculas la guarda de infinitivo no aplica', () => {
    assert.strictEqual(verificar('// TODO verde = 0').length, 1);
    assert.strictEqual(verificar('// TODO pendiente').length, 1);
  });

  test('linea de disable-next-line con el id no se auto-marca (guarda de compuesto)', () => {
    const v = verificar('// sentinel-disable-next-line todo-prosa-sin-marcador\n// todo revisar esto');
    assert.strictEqual(v.length, 0);
  });
});

suite('todo-prosa-sin-marcador: identificadores compuestos', () => {
  test('no marca todo dentro de un kebab-case (evento regenerar-todo)', () => {
    assert.strictEqual(verificar('// evento regenerar-todo registrado en el log').length, 0);
  });
});

suite('289A-1 todo-prosa-sin-marcador: supresiones sentinel', () => {
  test('sentinel-disable-file silencia el archivo', () => {
    const v = verificar('// sentinel-disable-file todo-prosa-sin-marcador\n// todo revisar esto');
    assert.strictEqual(v.length, 0);
  });

  test('sentinel-disable inline silencia la linea', () => {
    const v = verificar('// todo revisar esto // sentinel-disable todo-prosa-sin-marcador');
    assert.strictEqual(v.length, 0);
  });

  test('regla deshabilitada por config no reporta', () => {
    configurarOverridesReglas({ 'todo-prosa-sin-marcador': { habilitada: false } });
    try {
      assert.strictEqual(reglaHabilitada('todo-prosa-sin-marcador'), false);
    } finally {
      configurarOverridesReglas({});
      invalidarRegistroReglas();
    }
    assert.strictEqual(reglaHabilitada('todo-prosa-sin-marcador'), true);
  });
});
