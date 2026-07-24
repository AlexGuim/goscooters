import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Cálculo puro do histórico do ativo (P&L por moto), SEM autorização — quem
 * chama garante o acesso: o admin por requireAdmin, o portal validando que a
 * moto é do parceiro. Regime de caixa (valor_pago), coerente com o acerto.
 */
export interface HistoricoAtivo {
  matricula: string | null;
  modelo: string;
  data_aquisicao: string | null;
  valor_aquisicao: number | null;
  receita: number;
  custo: number;
  resultado: number;
  roi: number | null;
  recuperado: boolean | null;
  km_percorridos: number | null;
  custo_km: number | null;
  receita_km: number | null;
  n_despesas: number;
  n_rendas_pagas: number;
}

export async function calcularHistoricoAtivo(motoId: string): Promise<HistoricoAtivo | null> {
  const { data: m } = await supabaseAdmin
    .from("moto")
    .select("matricula, modelo, data_aquisicao, valor_aquisicao")
    .eq("id", motoId)
    .maybeSingle();
  if (!m) return null;

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
  };
}
