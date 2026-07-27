/**
 * Formatação de datas em português de Portugal / Brasil: dia antes do mês.
 * Recebe ISO (AAAA-MM-DD) e devolve DD/MM/AAAA ou DD/MM.
 */
export function dataBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = iso.slice(0, 10);
  const [ano, mes, dia] = s.split("-");
  if (!ano || !mes || !dia) return s;
  return `${dia}/${mes}/${ano}`;
}

export function dataCurtaBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = iso.slice(0, 10);
  const [, mes, dia] = s.split("-");
  if (!mes || !dia) return s;
  return `${dia}/${mes}`;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * Rótulo "Semana N de <mês>" da semana de calendário (domingo→sábado) que contém
 * `iso`. A semana pertence ao mês onde está a MAIORIA dos seus dias — que, numa
 * semana domingo→sábado, é sempre o mês da quarta-feira (o 4.º dia). N é a posição
 * dessa semana no mês (a 1.ª quarta é a Semana 1, a 2.ª a Semana 2, …).
 *
 * Usa sempre a semana domingo→sábado, mesmo que `iso` seja outro dia (ex.: o
 * início de um período de contrato à sexta), para que o rótulo bata certo com a
 * coluna do roster onde essa cobrança aparece.
 */
export function rotuloSemanaMes(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return iso.slice(0, 10);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  // Recua ao domingo e avança 3 dias → quarta-feira (dia representativo da semana).
  d.setUTCDate(d.getUTCDate() - d.getUTCDay() + 3);
  const n = Math.floor((d.getUTCDate() - 1) / 7) + 1;
  return `Semana ${n} de ${MESES[d.getUTCMonth()]}`;
}
