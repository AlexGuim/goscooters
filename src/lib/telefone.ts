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

/**
 * Converte um telefone para o formato E.164 (+351...), a chave de roteamento
 * WhatsApp. Devolve null quando não é possível ter confiança no formato.
 * Assume +351 para os 9 dígitos portugueses; mantém o indicativo internacional
 * quando o número já o traz.
 */
export function paraE164(telefone: string): string | null {
  const bruto = (telefone ?? "").trim();
  if (!bruto) return null;

  const tinhaIndicativo = bruto.startsWith("+") || bruto.includes("00");
  let d = bruto.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);

  if (d.length === 9 && /^[92]/.test(d)) return `+351${d}`;
  if (d.startsWith("351") && d.length === 12) return `+${d}`;
  if (tinhaIndicativo && d.length >= 8) return `+${d}`;
  if (d.length > 9) return `+${d}`;
  return null;
}
