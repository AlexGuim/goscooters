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
    .select("id, data_recebimento")
    .gte("data_recebimento", de)
    .lte("data_recebimento", ate);
  const mesDoPagamento = new Map<string, number>();
  for (const p of pagamentos ?? []) {
    mesDoPagamento.set(p.id, Number(p.data_recebimento.slice(5, 7)));
  }

  const receita = new Array(13).fill(0);
  const turnover = new Array(13).fill(0);
  const despesas = new Array(13).fill(0);

  const pagIds = [...mesDoPagamento.keys()];
  if (pagIds.length > 0) {
    const { data: alocs } = await supabaseAdmin
      .from("pagamento_cobranca")
      .select("pagamento_id, valor_alocado, cobranca:cobranca_id(veiculo_id, tipo)")
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
      receita[mes] += valor * taxa;
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
  const tot = { receita_gs: 0, despesas_gs: 0, resultado: 0, turnover: 0 };
  for (let m = 1; m <= 12; m++) {
    const rg = r2(receita[m]);
    const dg = r2(despesas[m]);
    meses.push({ mes: m, receita_gs: rg, despesas_gs: dg, resultado: r2(rg - dg), turnover: r2(turnover[m]) });
    tot.receita_gs += rg;
    tot.despesas_gs += dg;
    tot.turnover += turnover[m];
  }
  tot.receita_gs = r2(tot.receita_gs);
  tot.despesas_gs = r2(tot.despesas_gs);
  tot.turnover = r2(tot.turnover);
  tot.resultado = r2(tot.receita_gs - tot.despesas_gs);

  return { ano, meses, total: tot };
}
