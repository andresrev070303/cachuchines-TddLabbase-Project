import calcular from './calculadora.js';

describe('Calculadora de cadenas', () => {
  it('deberia devolver 0 para una cadena vacia', () => {
    expect(calcular('')).toEqual(0);
  });

  it('deberia devolver el mismo numero si la cadena tiene uno solo', () => {
    expect(calcular('4')).toEqual(4);
  });

  it('deberia sumar dos numeros separados por coma', () => {
    expect(calcular('1,2')).toEqual(3);
  });

  it('deberia sumar cualquier cantidad de numeros', () => {
    expect(calcular('1,2,3,4')).toEqual(10);
  });
});
