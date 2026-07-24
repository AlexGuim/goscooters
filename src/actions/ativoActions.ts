"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";

/**
 * Histórico do ativo (P&L por moto): desde a aquisição, receita cobrada vs
 * custos, e indicadores ao longo da vida útil. Regime de CAIXA (valor_pago),
 * coerente com o acerto. Serve o admin agora e o portal do parceiro depois.
 */
export interface HistoricoAtivo {
  matricula: string | null;
  modelo: string;
  data_aquisicao: string | null;
  valor_aquisicao: number | null;
  receita: number; // renda cobrada (valor_pago) da moto
  custo: number; // despesas do veículo (valor_total)
  resultado: number; // receita − custo (resultado operacional bruto)
  roi: number | null; // resultado / valor_aquisicao, em %
  recuperado: boolean | null; // já cobriu o valor de aquisição?
  km_percorridos: number | null;
  custo_km: number | null;
  receita_km: number | null;
  n_despesas: number;
  n_rendas_pagas: number;
}

export async function historicoAtivo(
  motoId: string,
): Promise<{ success: boolean; dados?: HistoricoAtivo; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data: m } = await supabaseAdmin
    .from("moto")
    .select("matricula, modelo, data_aquisicao, valor_aquisicao")
    .eq("id", motoId)
    .maybeSingle();
  if (!m) return { success: false, error: "Moto não encontrada." };

  const [rendasRes, despesasRes, kmsRes] = await Promise.all([
    supabaseAdmin.from("cobranca").select("valor_pago").eq("veiculo_id", motoId).eq("tipo", "renda"),
    supabaseAdmin.from("despesa").select("valor_total").eq("veiculo_id", motoId),
    supabaseAdmin.from("km_registo").select("km").eq("veiculo_id", motoId),
  ]);

  const receita = (rendasRes.data ?? []).reduce((s, r) => s + Number(r.valor_pago), 0);
  const nRendas = (rendasRes.data ?? []).filter((r) => Number(r.valor_pago) > 0).length;
  const custo = (despesasRes.data ?? []).reduce((s, d) => s + Number(d.valor_total), 0);
  const kmVals = (kmsRes.data ?? []).map((k) => Number(k.km)).filter((n) => Number.isFinite(n));
  const kmPerc = kmVals.length >= 2 ? Math.max(...kmVals) - Math.min(...kmVals) : null;

  const valorAq = m.valor_aquisicao != null ? Number(m.valor_aquisicao) : null;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const resultado = r2(receita - custo);

  return {
    success: true,
    dados: {
      matricula: m.matricula,
      modelo: m.modelo,
      data_aquisicao: m.data_aquisicao,
      valor_aquisicao: valorAq,
      receita: r2(receita),
      custo: r2(custo),
      resultado,
      roi: valorAq && valorAq > 0 ? Math.round((resultado / valorAq) * 1000) / 10 : null,
      recuperado: valorAq && valorAq > 0 ? resultado >= valorAq : null,
      km_percorridos: kmPerc,
      custo_km: kmPerc && kmPerc > 0 ? r2(custo / kmPerc) : null,
      receita_km: kmPerc && kmPerc > 0 ? r2(receita / kmPerc) : null,
      n_despesas: (despesasRes.data ?? []).length,
      n_rendas_pagas: nRendas,
    },
  };
}
