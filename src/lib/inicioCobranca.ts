/**
 * As duas contas do bloco Cobrança do Início.
 *
 * São as mesmas do ecrã da Cobrança, e é essa a razão de existirem aqui: o
 * Início dizia «3 em atraso» e a lista abria com outro número. Agora a regra do
 * que conta (e do que não conta) está num sítio só, e testada.
 *
 * Os valores chegam da vista `vw_cobranca_estado` como texto (numeric do
 * Postgres) — por isso cada campo aceita número ou texto.
 *
 * Pura, sem Supabase nem Next — testada em inicioCobranca.test.mjs.
 */

/** O que falta receber de uma cobrança, já com o desconto abatido pela vista. */
export interface LinhaEmAtraso {
  em_falta: number | string;
}

export interface EmAtraso {
  /** Soma do que falta receber. */
  valor: number;
  /** Quantas cobranças. */
  n: number;
}

/** Uma renda da semana, como a vista a devolve. */
export interface LinhaDaSemana {
  valor_devido: number | string;
  valor_pago: number | string;
  desconto?: number | string | null;
  em_falta: number | string;
  estado_liquidacao: string;
}

export interface SemanaDeRendas {
  /** O que havia a receber, já sem o que foi abatido por serviço não prestado. */
  devido: number;
  /** O que entrou. */
  recebido: number;
  /** O que ainda falta receber. */
  falta: number;
  /** Quantas rendas vencem na semana. */
  n: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Um numeric do Postgres (texto) ou um número; o que não for número dá 0. */
function valor(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * O que está em atraso: quanto e quantas cobranças.
 *
 * Quem filtra é a consulta, com o MESMO filtro da página Cobrança — `em_atraso`
 * (que a vista só dá a por liquidar e parciais já vencidas) e sem cauções, que
 * se cobram em mão na entrega e nunca estão «em atraso». Aqui só se soma.
 */
export function emAtraso(linhas: readonly LinhaEmAtraso[]): EmAtraso {
  let total = 0;
  for (const l of linhas) total += valor(l.em_falta);
  return { valor: r2(total), n: linhas.length };
}

/**
 * A semana de rendas: recebido X de Y, falta Z.
 *
 * As anuladas nunca foram devidas — saem da conta toda (a consulta já as
 * deixa de fora; aqui garante-se na mesma, para a regra viver num sítio só).
 *
 * `devido` é o valor da renda menos o desconto, que é o que há MESMO a receber:
 * uma semana com a mota na oficina não se cobra inteira. Quando uma renda é
 * dada como perda, `falta` passa a 0 mas `devido` fica — e é por isso que
 * recebido + falta pode ficar abaixo do devido: a diferença é o que se perdeu.
 */
export function semanaDeRendas(linhas: readonly LinhaDaSemana[]): SemanaDeRendas {
  let devido = 0;
  let recebido = 0;
  let falta = 0;
  let n = 0;
  for (const l of linhas) {
    if (l.estado_liquidacao === "anulada") continue;
    devido += valor(l.valor_devido) - valor(l.desconto);
    recebido += valor(l.valor_pago);
    falta += valor(l.em_falta);
    n++;
  }
  return { devido: r2(devido), recebido: r2(recebido), falta: r2(falta), n };
}
