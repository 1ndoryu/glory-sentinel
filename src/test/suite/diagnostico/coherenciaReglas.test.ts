import * as assert from 'assert';
import { reglasEstaticas } from '../../../config/defaultRules';
import { obtenerTodasLasReglas } from '../../../config/ruleRegistry';

/* [SQ-5] Hoy hay dos tablas que describen las mismas reglas: el REGISTRO de ruleRegistry.ts
 * (estado, severidad y categoria; fuente de verdad para la configuracion y para rules.md) y
 * reglasEstaticas de defaultRules.ts (el patron de las reglas regex). Este test impide que
 * diverjan: cada id estatico esta registrado y declara la misma severidad y categoria. */
suite('reglas - coherencia entre registro y reglas estaticas', () => {
  const registro = new Map(obtenerTodasLasReglas().map(regla => [regla.id, regla]));

  test('todo id de reglasEstaticas esta en el registro', () => {
    const sinRegistro = reglasEstaticas.filter(regla => !registro.has(regla.id)).map(regla => regla.id);
    assert.deepStrictEqual(sinRegistro, [], `reglas sin entrada en el registro: ${sinRegistro.join(', ')}`);
  });

  test('no hay ids repetidos en reglasEstaticas', () => {
    const ids = reglasEstaticas.map(regla => regla.id);
    const repetidos = ids.filter((id, indice) => ids.indexOf(id) !== indice);
    assert.deepStrictEqual([...new Set(repetidos)], [], `ids repetidos: ${repetidos.join(', ')}`);
  });

  test('severidad y categoria coinciden con el registro', () => {
    const discrepancias = reglasEstaticas.flatMap(regla => {
      const definicion = registro.get(regla.id);
      if (!definicion) return [];
      const motivos: string[] = [];
      if (definicion.severidadDefault !== regla.severidad) {
        motivos.push(`${regla.id}: severidad ${regla.severidad} en defaultRules y ${definicion.severidadDefault} en el registro`);
      }
      if (definicion.categoria !== regla.categoria) {
        motivos.push(`${regla.id}: categoria ${regla.categoria} en defaultRules y ${definicion.categoria} en el registro`);
      }
      return motivos;
    });
    assert.deepStrictEqual(discrepancias, []);
  });

  /* Testigo: sin reglas comparadas, los tests anteriores pasarian en vacio. */
  test('la tabla estatica no esta vacia', () => {
    assert.ok(reglasEstaticas.length > 0, 'defaultRules debe declarar al menos una regla');
  });
});
