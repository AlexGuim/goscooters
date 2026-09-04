import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Consolidação financeira da GoScooters, em regime de CAIXA (data em que o
 * dinheiro foi recebido). Evita a dupla contagem tratando a renda bruta como
 * dinheiro de passagem e reconhecendo como RECEITA da casa apenas:
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
  const de = `${ano}-01-01`;
  const ate = `${ano}-12-31`;

  // Mapas de taxa efetiva por veículo.
  const [{ data: motos }, { data: donos }] = await Promise.all([
    supabaseAdmin.from("moto").select("id, proprietario_id, comissao_valor_override"),
    supabaseAdmin.from("proprietario").select("id, comissao_valor, eh_goscooters"),
  ]);
  const donoDe = new Map((donos ?? []).map((d) => [d.id, d]));
  const taxaDe = new Map<string, number>(); // fração 0..1
  for (const m of motos ?? []) {
    const dono = m.proprietario_id ? donoDe.get(m.proprietario_id) : undefined;
    let taxa: number;
    if (dono?.eh_goscooters) taxa = 1; // frota própria: 100%
    else if (m.comissao_valor_override != null) taxa = Number(m.comissao_valor_override) / 100;
    else taxa = Number(dono?.comissao_valor ?? 0) / 100;
    taxaDe.set(m.id, taxa);
  }

  // Pagamentos do ano (regime de caixa) → data por mês.
  const { data: pagamentos } = await supabaseAdmin
    .from("pagamento")
    .select("id, data_recebimento, recebido_por")
    .gte("data_recebimento", de)
    .lte("data_recebimento", ate);
  const mesDoPagamento = new Map<string, number>();
  // Quem ficou com o dinheiro: decide se a receita entrou em caixa ou se vem
  // pelo acerto (comissão sobre renda que o parceiro cobrou).
  const gsRecebeu = new Map<string, boolean>();
  for (const p of pagamentos ?? []) {
    mesDoPagamento.set(p.id, Number(p.data_recebimento.slice(5, 7)));
    gsRecebeu.set(p.id, (p.recebido_por ?? "goscooters") === "goscooters");
  }

  const receita = new Array(13).fill(0);
  const emCaixa = new Array(13).fill(0);
  const viaAcerto = new Array(13).fill(0);
  const turnover = new Array(13).fill(0);
  const despesas = new Array(13).fill(0);

  const pagIds = [...mesDoPagamento.keys()];
  if (pagIds.length > 0) {
    const { data: alocs } = await supabaseAdmin
      .from("pagamento_cobranca")
      .select("pagamento_id, valor_alocado, cobranca:cobranca_id(veiculo_id, tipo, proprietario_id)")
      .in("pagamento_id", pagIds);

    for (const a of alocs ?? []) {
      const cob = Array.isArray(a.cobranca) ? a.cobranca[0] : a.cobranca;
      const c = cob as { veiculo_id?: string; tipo?: string } | null;
      if (!c || c.tipo !== "renda") continue; // só renda gera comissão/receita
      const mes = mesDoPagamento.get(a.pagamento_id as string);
      if (!mes) continue;
      const valor = Number(a.valor_alocado);
      const taxa = c.veiculo_id ? taxaDe.get(c.veiculo_id) ?? 0 : 0;
      turnover[mes] += valor;
      const r = valor * taxa;
      receita[mes] += r;
      // Frota própria (taxa 1) é sempre caixa. Numa moto de parceiro, só entrou
      // em caixa se foi a GoScooters a cobrar a renda.
      if (taxa === 1 || gsRecebeu.get(a.pagamento_id as string)) emCaixa[mes] += r;
      else viaAcerto[mes] += r;
    }
  }

  // Despesas próprias da GoScooters (imputar_a='goscooters'), por mês.
  const { data: desps } = await supabaseAdmin
    .from("despesa")
    .select("valor_total, data_despesa")
    .eq("imputar_a", "goscooters")
    .gte("data_despesa", de)
    .lte("data_despesa", ate);
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
    tot.receita_em_caixa += emCaixa[m];
    tot.receita_via_acerto += viaAcerto[m];
    tot.receita_gs += rg;
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
  const mm = String(mes).padStart(2, "0");
  const de = `${ano}-${mm}-01`;
  const ate = `${ano}-${mm}-${String(new Date(ano, mes, 0).getDate()).padStart(2, "0")}`;

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

  // Regime de caixa: o que interessa é a data em que o dinheiro entrou.
  const { data: pags } = await supabaseAdmin
    .from("pagamento")
    .select("id, recebido_por")
    .gte("data_recebimento", de)
    .lte("data_recebimento", ate);
  const pagIds = (pags ?? []).map((p) => p.id);
  const gsRecebeu = new Map(
    (pags ?? []).map((p) => [p.id as string, (p.recebido_por ?? "goscooters") === "goscooters"]),
  );

  const frota = new Map<string, number>();
  const porParceiro = new Map<string, { base: number; comissao: number }>();
  let turnover = 0;
  let receitaFrota = 0;
  let receitaComissao = 0;
  let emCaixa = 0;
  let viaAcerto = 0;

  if (pagIds.length) {
    const { data: alocs } = await supabaseAdmin
      .from("pagamento_cobranca")
      .select("valor_alocado, cobranca_id, pagamento_id")
      .in("pagamento_id", pagIds);
    const cobIds = [...new Set((alocs ?? []).map((a) => a.cobranca_id).filter(Boolean) as string[])];
    const { data: cobs } = cobIds.length
      ? await supabaseAdmin.from("cobranca").select("id, veiculo_id, tipo").in("id", cobIds)
      : { data: [] as { id: string; veiculo_id: string; tipo: string }[] };
    const cobDe = new Map((cobs ?? []).map((c) => [c.id, c]));

    for (const a of alocs ?? []) {
      const c = cobDe.get(a.cobranca_id as string);
      // Só renda: uma caução devolve-se e um refaturado é reembolso — nenhum é receita.
      if (!c || c.tipo !== "renda" || !c.veiculo_id) continue;
      const valor = Number(a.valor_alocado);
      const taxa = taxaDe.get(c.veiculo_id) ?? 0;
      turnover += valor;

      const moto = motoDe.get(c.veiculo_id);
      const dono = moto?.proprietario_id ? donoDe.get(moto.proprietario_id) : undefined;
      if (dono?.eh_goscooters) {
        frota.set(c.veiculo_id, (frota.get(c.veiculo_id) ?? 0) + valor);
        receitaFrota += valor;
        emCaixa += valor; // a renda da frota própria entra sempre na conta da casa
      } else if (dono) {
        const at = porParceiro.get(dono.id) ?? { base: 0, comissao: 0 };
        at.base += valor;
        at.comissao += valor * taxa;
        porParceiro.set(dono.id, at);
        receitaComissao += valor * taxa;
        // Se foi o parceiro a cobrar, a comissão só chega pelo acerto.
        if (gsRecebeu.get(a.pagamento_id as string)) emCaixa += valor * taxa;
        else viaAcerto += valor * taxa;
      }
    }
  }

  const { data: desps } = await supabaseAdmin
    .from("despesa")
    .select("id, data_despesa, categoria, descricao, valor_total, veiculo_id, detalhe")
    .eq("imputar_a", "goscooters")
    .gte("data_despesa", de)
    .lte("data_despesa", ate)
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
