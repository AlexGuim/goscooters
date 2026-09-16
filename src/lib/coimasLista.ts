/**
 * A lista de coimas: em que situação está cada uma e por que ordem se tratam.
 * Sem dependências — testado em coimasLista.test.mjs. Os dias úteis até ao prazo
 * chegam calculados (diasUteis.ts).
 */

export type SituacaoCoima =
  | "em_atraso"
  | "a_acabar"
  | "sem_prazo"
  | "em_curso"
  | "enviada"
  | "anterior"
  | "nao_aplicavel";

/** Dias úteis (ou menos) até ao fim do prazo em que a coima passa a "a acabar" — e o alerta dispara. */
export const DIAS_UTEIS_A_ACABAR = 5;

/**
 * Uma coima sem processo cuja infração tem mais do que estes dias é anterior à
 * identificação na plataforma: não entra em "por tratar". Abri-la cria o processo.
 */
export const DIAS_ANTIGA_SEM_PROCESSO = 45;

/** As situações com trabalho por fazer. */
export const ABERTAS: readonly SituacaoCoima[] = ["em_atraso", "a_acabar", "sem_prazo", "em_curso"];

/** A infração (AAAA-MM-DD) tem mais de DIAS_ANTIGA_SEM_PROCESSO dias. */
export function ehAntiga(dataInfracao: string, hojeISO: string): boolean {
  const infracao = Date.parse(`${dataInfracao.slice(0, 10)}T00:00:00Z`);
  const hoje = Date.parse(`${hojeISO.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(infracao) || Number.isNaN(hoje)) return false;
  return (hoje - infracao) / 86_400_000 > DIAS_ANTIGA_SEM_PROCESSO;
}

/**
 * `estado`: o da linha `infracao` (null quando o processo ainda não existe).
 * `diasAtePrazo`: dias úteis até ao fim do prazo (negativo se já passou; null sem prazo).
 * `antiga`: a infração é antiga (ehAntiga) — só conta quando ainda não há processo.
 */
export function situacaoDaCoima(
  estado: string | null | undefined,
  diasAtePrazo: number | null,
  antiga = false,
): SituacaoCoima {
  if (estado === "enviada") return "enviada";
  if (estado === "nao_aplicavel") return "nao_aplicavel";
  if (!estado && antiga) return "anterior";
  if (diasAtePrazo == null) return "sem_prazo";
  if (diasAtePrazo < 0) return "em_atraso";
  if (diasAtePrazo <= DIAS_UTEIS_A_ACABAR) return "a_acabar";
  return "em_curso";
}

const PESO: Record<SituacaoCoima, number> = {
  em_atraso: 0,
  a_acabar: 1,
  sem_prazo: 2,
  em_curso: 3,
  enviada: 4,
  anterior: 5,
  nao_aplicavel: 6,
};

type Ordenavel = { situacao: SituacaoCoima; dias: number | null; data_infracao: string };

/**
 * Primeiro o que arde: prazo passado, a acabar, sem data de notificação, em curso;
 * depois as fechadas. Dentro de cada grupo, o prazo mais curto — e, sem prazo, a
 * infração mais recente.
 */
export function compararUrgencia(a: Ordenavel, b: Ordenavel): number {
  const peso = PESO[a.situacao] - PESO[b.situacao];
  if (peso) return peso;
  if (a.dias != null && b.dias != null && a.dias !== b.dias) return a.dias - b.dias;
  return b.data_infracao.localeCompare(a.data_infracao);
}
