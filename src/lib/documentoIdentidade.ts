/**
 * Documento de identidade: o n.º e a data de emissão que vão lado a lado no F306
 * das coimas. Sem imports — serve as actions e os ecrãs.
 *
 * Uma data do documento anterior ao lado do n.º novo é um erro no F306; apagar a
 * data certa porque o mesmo n.º veio com outros espaços é perder o que o CC nem
 * imprime. Por isso "outro documento" decide-se só aqui.
 */

/** N.º do documento sem espaços, pontos, hífenes e barras, em maiúsculas. */
export function normalizarNumeroDocumento(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/[\s./-]/g, "")
    .toUpperCase();
}

/** O mesmo documento, escrito de outra forma: "12345678 9 ZZ1" é "123456789zz1". */
export function mesmoDocumento(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizarNumeroDocumento(a) === normalizarNumeroDocumento(b);
}

/**
 * A data, se for AAAA-MM-DD e existir no calendário; senão null. A IA pode ler
 * "2021-06-31", que o Postgres recusa — e com ela a escrita inteira.
 */
export function dataDeDocumentoValida(v: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? "");
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const diasDoMes = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
  return ano >= 1 && diasDoMes !== undefined && dia >= 1 && dia <= diasDoMes ? v! : null;
}
