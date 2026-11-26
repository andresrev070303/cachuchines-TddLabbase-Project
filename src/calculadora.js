const SEPARADOR = ',';

function calcular(cadena) {
  if (cadena === '') {
    return 0;
  }
  return cadena
    .split(SEPARADOR)
    .map(Number)
    .reduce((total, numero) => total + numero, 0);
}

export default calcular;
