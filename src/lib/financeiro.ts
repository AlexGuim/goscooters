import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mesDaSemana } from "@/lib/datas";

/**
 * Consolidação financeira da GoScooters.
 *
 * A que MÊS pertence cada euro: à semana a que a renda diz respeito, pela regra
 * da quarta-feira — exatamente como o acerto do parceiro. Só conta o que foi
 * PAGO (uma semana por cobrar não é receita), mas o mês é o da semana e não o
 * do dia em que o dinheiro entrou.
 *
 * Foi assim de propósito: com a data do pagamento a mandar, uma semana de
 * setembro paga a 28/08 caía em agosto, e a comissão daqui divergia da do
 * acerto do mesmo mês (39 € de diferença em agosto/2026). Dois números com o
 * mesmo nome e valores diferentes não se defendem.
 *
 * Evita a dupla contagem tratando a renda bruta como dinheiro de passagem e
 * reconhecendo como RECEITA da casa apenas:
 *   - a comissão sobre as motos de parceiro, e
 *   - a renda integral da frota própria (taxa efetiva 100%).
 * Fórmula: Receita_GS = Σ (renda paga × taxa efetiva). Só conta tipo='renda'.
 * Resultado = Receita_GS − Despesas próprias (imputar_a='goscooters').
 */
export interface MesFinanceiro {
  mes: number; // 1..12
  receita_gs: number;
  /**
   * Parte da receita que entrou MESMO na conta da GoScooters (frota própria, ou
   * renda de parceiro que a GoScooters cobrou).
   */
  receita_em_caixa: number;
  /**
   * Comissão sobre renda que o PARCEIRO recebeu diretamente. É receita ganha,
   * mas o dinheiro nunca passou pela GoScooters — chega pelo acerto do mês.
   * Separada porque juntá-las diz "regime de caixa" e não é verdade.
   */
  receita_via_acerto: number;
  despesas_gs: number;
  resultado: number;
  turnover: number; // renda bruta cobrada (memorando)
}

export interface FinanceiroAno {
  ano: number;
  meses: MesFinanceiro[];
  total: Omit<MesFinanceiro, "mes">;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function financeiroAno(ano: number): Promise<FinanceiroAno> {
  // Janela generosa: uma semana de janeiro pode vencer em dezembro do ano
  // anterior, e uma de dezembro em janeiro do seguinte. Filtra-se depois pela
  // regra da quarta-feira, que é quem manda.
  const de = `${ano - 1}-12-01`;
  const ate = `${ano + 1}-01-31`;

  const { taxaDe, ehPropria } = await mapasDeTaxa();

  // MESMA regra do acerto do parceiro: a semana pertence ao mês da sua
  // quarta-feira, e conta-se o que foi PAGO dessa semana — não o dinheiro que
  // entrou no mês. Assim "agosto" quer dizer o mesmo em todo o sistema.
  const { data: cobs } = await supabaseAdmin
    .from("cobranca")
    .select("id, veiculo_id, valor_pago, data_vencimento")
    .eq("tipo", "renda")
    .gt("valor_pago", 0)
    .gte("data_vencimento", de)
    .lte("data_vencimento", ate);

  const doAno = (cobs ?? []).filter((c) => (mesDaSemana(c.data_vencimento) ?? "").startsWith(`${ano}-`));
  const gsPorCobranca = await parteRecebidaPelaGoScooters(doAno.map((c) => c.id));

  const receita = new Array(13).fill(0);
  const emCaixa = new Array(13).fill(0);
  const viaAcerto = new Array(13).fill(0);
  const turnover = new Array(13).fill(0);
  const despesas = new Array(13).fill(0);

  for (const c of doAno) {
    const mes = Number((mesDaSemana(c.data_vencimento) ?? "").slice(5, 7));
    if (!mes) continue;
    const pago = Number(c.valor_pago);
    const taxa = c.veiculo_id ? taxaDe.get(c.veiculo_id) ?? 0 : 0;
    const r = pago * taxa;
    turnover[mes] += pago;
    receita[mes] += r;
    if (ehPropria.get(c.veiculo_id)) {
      emCaixa[mes] += r; // frota própria: a renda entra sempre na conta da casa
    } else {
      // Numa moto de parceiro, a comissão só está em caixa na proporção do que
      // foi a GoScooters a cobrar; o resto vem pelo acerto.
      const gs = Math.min(gsPorCobranca.get(c.id) ?? 0, pago);
      const fracao = pago > 0 ? gs / pago : 0;
      emCaixa[mes] += r * fracao;
      viaAcerto[mes] += r * (1 - fracao);
    }
  }

  // As despesas são eventos pontuais: pertencem ao seu mês de calendário.
  const { data: desps } = await supabaseAdmin
    .from("despesa")
    .select("valor_total, data_despesa")
    .eq("imputar_a", "goscooters")
    .gte("data_despesa", `${ano}-01-01`)
    .lte("data_despesa", `${ano}-12-31`);
  for (const d of desps ?? []) {
    despesas[Number(d.data_despesa.slice(5, 7))] += Number(d.valor_total);
  }

  const meses: MesFinanceiro[] = [];
  const tot = { receita_gs: 0, receita_em_caixa: 0, receita_via_acerto: 0, despesas_gs: 0, resultado: 0, turnover: 0 };
  for (let m = 1; m <= 12; m++) {
    const rg = r2(receita[m]);
    const dg = r2(despesas[m]);
    meses.push({
      mes: m,
      receita_gs: rg,
      receita_em_caixa: r2(emCaixa[m]),
      receita_via_acerto: r2(viaAcerto[m]),
      despesas_gs: dg,
      resultado: r2(rg - dg),
      turnover: r2(turnover[m]),
    });
    tot.receita_gs += rg;
    tot.receita_em_caixa += emCaixa[m];
    tot.receita_via_acerto += viaAcerto[m];
    tot.despesas_gs += dg;
    tot.turnover += turnover[m];
  }
  tot.receita_gs = r2(tot.receita_gs);
  tot.receita_em_caixa = r2(tot.receita_em_caixa);
  tot.receita_via_acerto = r2(tot.receita_via_acerto);
  tot.despesas_gs = r2(tot.despesas_gs);
  tot.turnover = r2(tot.turnover);
  tot.resultado = r2(tot.receita_gs - tot.despesas_gs);

  return { ano, meses, total: tot };
}

/** Taxa efetiva por veículo (frota própria = 1) e se é frota própria. */
async function mapasDeTaxa() {
  const [{ data: motos }, { data: donos }] = await Promise.all([
    supabaseAdmin.from("moto").select("id, proprietario_id, comissao_valor_override"),
    supabaseAdmin.from("proprietario").select("id, comissao_valor, eh_goscooters"),
  ]);
  const donoDe = new Map((donos ?? []).map((d) => [d.id, d]));
  const taxaDe = new Map<string, number>();
  const ehPropria = new Map<string, boolean>();
  for (const m of motos ?? []) {
    const dono = m.proprietario_id ? donoDe.get(m.proprietario_id) : undefined;
    ehPropria.set(m.id, !!dono?.eh_goscooters);
    taxaDe.set(
      m.id,
      dono?.eh_goscooters
        ? 1
        : (m.comissao_valor_override != null
            ? Number(m.comissao_valor_override)
            : Number(dono?.comissao_valor ?? 0)) / 100,
    );
  }
  return { taxaDe, ehPropria };
}

/** Quanto de cada cobrança foi cobrado PELA GoScooters (o resto foi ao parceiro). */
async function parteRecebidaPelaGoScooters(cobIds: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (!cobIds.length) return mapa;
  const { data: alocs } = await supabaseAdmin
    .from("pagamento_cobranca")
    .select("cobranca_id, valor_alocado, pagamento:pagamento_id(recebido_por)")
    .in("cobranca_id", cobIds);
  for (const a of alocs ?? []) {
    const pj = Array.isArray(a.pagamento) ? a.pagamento[0] : a.pagamento;
    const rp = (pj as { recebido_por?: string } | null)?.recebido_por ?? "goscooters";
    if (rp !== "goscooters") continue;
    const k = a.cobranca_id as string;
    mapa.set(k, (mapa.get(k) ?? 0) + Number(a.valor_alocado));
  }
  return mapa;
}

// ── Detalhe de um mês ───────────────────────────────────────────────────────

/** Uma moto da frota própria: a renda dela é receita a 100%. */
export interface LinhaFrotaPropria {
  veiculo_id: string;
  matricula: string | null;
  valor: number;
}

/** Um parceiro: a receita é a comissão sobre a renda que os motoristas pagaram. */
export interface LinhaComissao {
  proprietario_id: string;
  nome: string;
  /** Renda paga pelos motoristas das motos deste parceiro (base da comissão). */
  base: number;
  /** Taxa média efetiva aplicada (%), útil quando há override por moto. */
  taxa_media: number;
  comissao: number;
}

/** Uma despesa própria, com a fatura para se poder conferir. */
export interface LinhaDespesaPropria {
  id: string;
  data: string;
  categoria: string;
  descricao: string | null;
  matricula: string | null;
  valor: number;
  documento_url: string | null;
}

export interface MesDetalhado extends MesFinanceiro {
  ano: number;
  frota_propria: LinhaFrotaPropria[];
  comissoes: LinhaComissao[];
  despesas: LinhaDespesaPropria[];
  /** Renda da frota própria (soma de frota_propria) — parte da receita. */
  receita_frota: number;
  /** Soma das comissões — a outra parte da receita. */
  receita_comissao: number;
}

/**
 * O mesmo cálculo do ano, mas aberto: de onde veio cada euro num mês.
 *
 * Existe porque a tabela anual dizia "Agosto: 904 €" e mais nada — não se via
 * que motos, que parceiros, que despesas. O parceiro tem esse detalhe todo no
 * acerto dele; faltava à casa ter o seu.
 *
 * Recalcula sempre a partir dos dados (não congela): se se corrigir um
 * pagamento de agosto, agosto acompanha.
 */
export async function financeiroMes(ano: number, mes: number): Promise<MesDetalhado> {
  const competencia = `${ano}-${String(mes).padStart(2, "0")}`;
  const mm = String(mes).padStart(2, "0");
  // Janela larga: a semana da virada do mês vence fora dele. Filtra-se depois
  // pela quarta-feira.
  const de = `${ano}-${mm}-01`;
  const janelaDe = new Date(Date.UTC(ano, mes - 1, 1));
  janelaDe.setUTCDate(janelaDe.getUTCDate() - 8);
  const janelaAte = new Date(Date.UTC(ano, mes, 0));
  janelaAte.setUTCDate(janelaAte.getUTCDate() + 8);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const [{ data: motos }, { data: donos }] = await Promise.all([
    supabaseAdmin.from("moto").select("id, matricula, proprietario_id, comissao_valor_override"),
    supabaseAdmin.from("proprietario").select("id, nome, comissao_valor, eh_goscooters"),
  ]);
  const donoDe = new Map((donos ?? []).map((d) => [d.id, d]));
  const motoDe = new Map((motos ?? []).map((m) => [m.id, m]));
  const taxaDe = new Map<string, number>();
  for (const m of motos ?? []) {
    const dono = m.proprietario_id ? donoDe.get(m.proprietario_id) : undefined;
    taxaDe.set(
      m.id,
      dono?.eh_goscooters
        ? 1
        : (m.comissao_valor_override != null
            ? Number(m.comissao_valor_override)
            : Number(dono?.comissao_valor ?? 0)) / 100,
    );
  }

  // Semanas QUE PERTENCEM a este mês (regra da quarta-feira), e pagas.
  const { data: cobs } = await supabaseAdmin
    .from("cobranca")
    .select("id, veiculo_id, valor_pago, data_vencimento")
    .eq("tipo", "renda")
    .gt("valor_pago", 0)
    .gte("data_vencimento", iso(janelaDe))
    .lte("data_vencimento", iso(janelaAte));
  const doMes = (cobs ?? []).filter((c) => mesDaSemana(c.data_vencimento) === competencia);
  const gsPorCobranca = await parteRecebidaPelaGoScooters(doMes.map((c) => c.id));

  const frota = new Map<string, number>();
  const porParceiro = new Map<string, { base: number; comissao: number }>();
  let turnover = 0;
  let receitaFrota = 0;
  let receitaComissao = 0;
  let emCaixa = 0;
  let viaAcerto = 0;

  for (const c of doMes) {
    if (!c.veiculo_id) continue;
    const pago = Number(c.valor_pago);
    const taxa = taxaDe.get(c.veiculo_id) ?? 0;
    turnover += pago;
    const moto = motoDe.get(c.veiculo_id);
    const dono = moto?.proprietario_id ? donoDe.get(moto.proprietario_id) : undefined;

    if (dono?.eh_goscooters) {
      frota.set(c.veiculo_id, (frota.get(c.veiculo_id) ?? 0) + pago);
      receitaFrota += pago;
      emCaixa += pago;
    } else if (dono) {
      const com = pago * taxa;
      const at = porParceiro.get(dono.id) ?? { base: 0, comissao: 0 };
      at.base += pago;
      at.comissao += com;
      porParceiro.set(dono.id, at);
      receitaComissao += com;
      const gs = Math.min(gsPorCobranca.get(c.id) ?? 0, pago);
      const fracao = pago > 0 ? gs / pago : 0;
      emCaixa += com * fracao;
      viaAcerto += com * (1 - fracao);
    }
  }

  const ultimo = String(new Date(ano, mes, 0).getDate()).padStart(2, "0");
  const { data: desps } = await supabaseAdmin
    .from("despesa")
    .select("id, data_despesa, categoria, descricao, valor_total, veiculo_id, detalhe")
    .eq("imputar_a", "goscooters")
    .gte("data_despesa", de)
    .lte("data_despesa", `${ano}-${mm}-${ultimo}`)
    .order("data_despesa");

  const despesas: LinhaDespesaPropria[] = (desps ?? []).map((d) => ({
    id: d.id,
    data: d.data_despesa as string,
    categoria: d.categoria as string,
    descricao: (d.descricao as string) ?? null,
    matricula: d.veiculo_id ? motoDe.get(d.veiculo_id)?.matricula ?? null : null,
    valor: Number(d.valor_total),
    documento_url: (d.detalhe as { documento_url?: string } | null)?.documento_url ?? null,
  }));
  const despesasTotal = despesas.reduce((s, d) => s + d.valor, 0);
  const receita = receitaFrota + receitaComissao;

  return {
    ano,
    mes,
    receita_gs: r2(receita),
    receita_em_caixa: r2(emCaixa),
    receita_via_acerto: r2(viaAcerto),
    despesas_gs: r2(despesasTotal),
    resultado: r2(receita - despesasTotal),
    turnover: r2(turnover),
    receita_frota: r2(receitaFrota),
    receita_comissao: r2(receitaComissao),
    frota_propria: [...frota.entries()]
      .map(([id, valor]) => ({ veiculo_id: id, matricula: motoDe.get(id)?.matricula ?? null, valor: r2(valor) }))
      .sort((a, b) => (a.matricula ?? "").localeCompare(b.matricula ?? "")),
    comissoes: [...porParceiro.entries()]
      .map(([id, v]) => ({
        proprietario_id: id,
        nome: donoDe.get(id)?.nome ?? "—",
        base: r2(v.base),
        taxa_media: v.base > 0 ? r2((v.comissao / v.base) * 100) : 0,
        comissao: r2(v.comissao),
      }))
      .sort((a, b) => b.comissao - a.comissao),
    despesas,
  };
}
