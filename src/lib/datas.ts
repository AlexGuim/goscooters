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
 * Saudação por hora de Lisboa + data por extenso (ex.: "segunda-feira, 28 de julho").
 * Serve o hero de marca (dashboard admin e portal). Fuso fixo Europe/Lisbon para
 * bater certo com a operação, independentemente do fuso do servidor.
 */
export function saudacaoLisboa(agora: Date = new Date()): { saudacao: string; data: string } {
  const hora = Number(
    new Intl.DateTimeFormat("pt-PT", { hour: "numeric", hour12: false, timeZone: "Europe/Lisbon" }).format(agora),
  );
  const saudacao = hora < 12 ? "Bom dia" : hora < 20 ? "Boa tarde" : "Boa noite";
  const data = new Intl.DateTimeFormat("pt-PT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Lisbon",
  }).format(agora);
  return { saudacao, data };
}

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
/**
 * A quarta-feira (4.º dia, o representativo) da semana domingo→sábado que contém
 * `iso`. É o dia que decide a que MÊS a semana pertence — fonte única partilhada
 * por `rotuloSemanaMes` (o rótulo) e `mesDaSemana` (a atribuição do acerto), para
 * que os dois nunca divirjam.
 */
function quartaDaSemana(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay() + 3); // recua ao domingo, avança à quarta
  return d;
}

export function rotuloSemanaMes(iso: string | null | undefined): string {
  const d = quartaDaSemana(iso);
  if (!d) return iso ? iso.slice(0, 10) : "—";
  const n = Math.floor((d.getUTCDate() - 1) / 7) + 1;
  return `Semana ${n} de ${MESES[d.getUTCMonth()]}`;
}

/**
 * "YYYY-MM" do mês a que a semana (domingo→sábado) de `iso` pertence — o mês da
 * sua quarta-feira. Usado pelo acerto para incluir cada cobrança no mês certo,
 * exatamente como o rótulo `rotuloSemanaMes` a mostra (independente do dia da
 * semana em que o vencimento calha). Null se `iso` for inválido.
 */
export function mesDaSemana(iso: string | null | undefined): string | null {
  const d = quartaDaSemana(iso);
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
