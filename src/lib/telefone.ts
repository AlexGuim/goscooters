/**
 * Reduz um número de telefone aos seus dígitos, para reconhecer o mesmo número
 * escrito de formas diferentes (+351 91 123 4567, 00351911234567, 911234567).
 *
 * Descarta um indicativo 351 à cabeça, já que a esmagadora maioria dos números
 * é portuguesa — assim "+351 911..." e "911..." batem certo.
 */
export function normalizarTelefone(telefone: string): string {
  let digitos = (telefone ?? "").replace(/\D/g, "");

  if (digitos.startsWith("00351")) {
    digitos = digitos.slice(5);
  } else if (digitos.startsWith("351") && digitos.length > 9) {
    digitos = digitos.slice(3);
  }

  return digitos;
}
