"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { dataCurtaBR } from "@/lib/datas";
import type { AcertoLinhaTipo } from "@/types/db";

/**
 * Acerto mensal por parceiro.
 *
 * Fórmula (a validar com o utilizador):
 *   Receita  = valor PAGO das cobranças dos veículos do parceiro cujo
 *              vencimento cai no mês.
 *   Comissão = por veículo, receita × comissão% (override do veículo, ou a %
 *              base do proprietário). Receita da GoScooters.
 *   Despesas = despesas imputadas ao PROPRIETÁRIO, no mês.
 *   Líquido  = Receita − Comissão − Despesas.
 *
 * `calcular` faz a pré-visualização (não grava). `fechar` congela em acerto_linha.
 */

export interface AcertoLinhaPreview {
  tipo: AcertoLinhaTipo;
  descricao: string;
  matricula: string | null;
  veiculo_id: string | null;
  cobranca_id: string | null;
  despesa_id: string | null;
  valor: number; // receita + ; despesa/comissão −
}

export interface AcertoPreview {
  proprietario_id: string;
  proprietario_nome: string;
  competencia_mes: string;
  periodo_inicio: string;
  periodo_fim: string;
  receita_total: number;
  /** Parte da receita efetivamente cobrada PELA GoScooters (0 se paga direto). */
  receita_goscooters: number;
  comissao_total: number;
  despesa_total: number;
  /** Renda paga direto na conta do parceiro (inverte o sentido do líquido). */
  pago_direto: boolean;
  /** Positivo = a transferir ao parceiro; negativo = o parceiro deve à GoScooters. */
  liquido: number;
  linhas: AcertoLinhaPreview[];
}

function periodoDoMes(competencia: string): { inicio: string; fim: string } {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimo = new Date(ano, mes, 0).getDate();
  return {
    inicio: `${competencia}-01`,
    fim: `${competencia}-${String(ultimo).padStart(2, "0")}`,
  };
}

async function computar(
  proprietarioId: string,
  competencia: string,
  inicio: string,
  fim: string,
): Promise<{ ok: true; preview: AcertoPreview } | { ok: false; error: string }> {
  // Select amplo (*) para ser tolerante a colunas recentes ainda não migradas
  // (ex.: recebe_pagamento_direto) — assim o acerto não parte antes da SQL.
  const { data: dono } = await supabaseAdmin
    .from("proprietario")
    .select("*")
    .eq("id", proprietarioId)
    .maybeSingle();
  if (!dono) return { ok: false, error: "Proprietário não encontrado." };
  // A frota própria não se acerta a si mesma: não há terceiro a quem transferir
  // nem comissão a cobrar. Os seus custos controlam-se no Financeiro/Despesas.
  if (dono.eh_goscooters) {
    return {
      ok: false,
      error: "A GoScooters (frota própria) não gera acerto — vê o Financeiro/Despesas.",
    };
  }
  // Renda paga direto na conta do parceiro: a GoScooters não cobrou esta receita,
  // por isso o extrato mostra só o que o parceiro DEVE (comissão + despesas).
  const pagoDireto = !!dono.recebe_pagamento_direto;

  const { data: veiculos } = await supabaseAdmin
    .from("moto")
    .select("id, matricula, comissao_valor_override")
    .eq("proprietario_id", proprietarioId);

  const veicIds = (veiculos ?? []).map((v) => v.id);
  const taxaBase = Number(dono.comissao_valor ?? 0);
  const taxaDe = new Map(
    (veiculos ?? []).map((v) => [
      v.id,
      v.comissao_valor_override != null ? Number(v.comissao_valor_override) : taxaBase,
    ]),
  );
  const matDe = new Map((veiculos ?? []).map((v) => [v.id, v.matricula]));

  const linhas: AcertoLinhaPreview[] = [];
  let receita = 0;
  const comissaoPorVeiculo = new Map<string, number>();

  if (veicIds.length > 0) {
    const { data: cobs } = await supabaseAdmin
      .from("cobranca")
      .select("id, veiculo_id, valor_pago, periodo_inicio, periodo_fim, data_vencimento")
      .in("veiculo_id", veicIds)
      .eq("tipo", "renda") // só renda gera comissão; caução/extra são reembolso
      .gte("data_vencimento", inicio)
      .lte("data_vencimento", fim);

    for (const c of cobs ?? []) {
      const pago = Number(c.valor_pago);
      if (pago <= 0) continue;
      receita += pago;
      const taxa = taxaDe.get(c.veiculo_id) ?? taxaBase;
      const com = Math.round(pago * taxa) / 100;
      comissaoPorVeiculo.set(
        c.veiculo_id,
        (comissaoPorVeiculo.get(c.veiculo_id) ?? 0) + com,
      );
      // Só emitir a linha de renda (positiva) quando a GoScooters a cobrou. No
      // pago direto a renda é do parceiro; as linhas ficam só comissão+despesa,
      // para o somatório do extrato bater certo com o líquido (que é negativo).
      if (!pagoDireto) {
        linhas.push({
          tipo: "receita",
          descricao: `Renda ${dataCurtaBR(c.periodo_inicio)}–${dataCurtaBR(c.periodo_fim)}`,
          matricula: matDe.get(c.veiculo_id) ?? null,
          veiculo_id: c.veiculo_id,
          cobranca_id: c.id,
          despesa_id: null,
          valor: pago,
        });
      }
    }
  }

  // Linhas de comissão (uma por veículo).
  let comissaoTotal = 0;
  for (const [veiculoId, com] of comissaoPorVeiculo) {
    const valor = Math.round(com * 100) / 100;
    comissaoTotal += valor;
    linhas.push({
      tipo: "comissao",
      descricao: `Comissão (${taxaDe.get(veiculoId) ?? taxaBase}%)`,
      matricula: matDe.get(veiculoId) ?? null,
      veiculo_id: veiculoId,
      cobranca_id: null,
      despesa_id: null,
      valor: -valor,
    });
  }

  // Despesas imputadas ao proprietário. Ao contrário das rendas (semanas que
  // podem atravessar meses), uma despesa é um evento pontual: pertence ao seu
  // mês de calendário (a competência), não à janela De/Até das semanas.
  const mesDesp = periodoDoMes(competencia);
  let despesaTotal = 0;
  const { data: desps } = await supabaseAdmin
    .from("despesa")
    .select("id, veiculo_id, valor_total, categoria, descricao")
    .eq("proprietario_id", proprietarioId)
    .eq("imputar_a", "proprietario")
    .gte("data_despesa", mesDesp.inicio)
    .lte("data_despesa", mesDesp.fim);

  for (const d of desps ?? []) {
    const v = Number(d.valor_total);
    despesaTotal += v;
    linhas.push({
      tipo: "despesa",
      descricao: `${d.categoria}${d.descricao ? ` · ${d.descricao}` : ""}`,
      matricula: d.veiculo_id ? matDe.get(d.veiculo_id) ?? null : null,
      veiculo_id: d.veiculo_id,
      cobranca_id: null,
      despesa_id: d.id,
      valor: -v,
    });
  }

  const receitaTotal = Math.round(receita * 100) / 100;
  comissaoTotal = Math.round(comissaoTotal * 100) / 100;
  despesaTotal = Math.round(despesaTotal * 100) / 100;

  // No pago direto a GoScooters não cobrou a receita → líquido negativo (o
  // parceiro deve comissão + despesas). Caso normal: a GoScooters cobrou tudo.
  const receitaGoscooters = pagoDireto ? 0 : receitaTotal;
  const liquido =
    Math.round((receitaGoscooters - comissaoTotal - despesaTotal) * 100) / 100;

  return {
    ok: true,
    preview: {
      proprietario_id: proprietarioId,
      proprietario_nome: dono.nome,
      competencia_mes: `${competencia}-01`,
      periodo_inicio: inicio,
      periodo_fim: fim,
      receita_total: receitaTotal,
      receita_goscooters: receitaGoscooters,
      comissao_total: comissaoTotal,
      despesa_total: despesaTotal,
      pago_direto: pagoDireto,
      liquido,
      linhas,
    },
  };
}

export async function calcularAcerto(
  proprietarioId: string,
  competencia: string,
  inicio?: string,
  fim?: string,
): Promise<{ success: boolean; preview?: AcertoPreview; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return { success: false, error: "Mês inválido (usa AAAA-MM)." };
  }
  const p = periodoDoMes(competencia);
  const de = inicio || p.inicio;
  const ate = fim || p.fim;

  const r = await computar(proprietarioId, competencia, de, ate);
  if (!r.ok) return { success: false, error: r.error };
  return { success: true, preview: r.preview };
}

export async function fecharAcerto(
  proprietarioId: string,
  competencia: string,
  inicio?: string,
  fim?: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  // Não fechar duas vezes o mesmo mês.
  const { data: existe } = await supabaseAdmin
    .from("acerto")
    .select("id")
    .eq("proprietario_id", proprietarioId)
    .eq("competencia_mes", `${competencia}-01`)
    .maybeSingle();
  if (existe) return { success: false, error: "Este mês já foi fechado para este parceiro." };

  const per = periodoDoMes(competencia);
  const r = await computar(proprietarioId, competencia, inicio || per.inicio, fim || per.fim);
  if (!r.ok) return { success: false, error: r.error };
  const p = r.preview;

  const { data: acerto, error } = await supabaseAdmin
    .from("acerto")
    .insert({
      proprietario_id: proprietarioId,
      competencia_mes: p.competencia_mes,
      periodo_inicio: p.periodo_inicio,
      periodo_fim: p.periodo_fim,
      receita_total: String(p.receita_total),
      receita_goscooters: String(p.receita_goscooters),
      despesa_total: String(p.despesa_total),
      comissao_total: String(p.comissao_total),
      pago_direto: p.pago_direto,
      liquido: String(p.liquido),
      estado: "fechado",
      fechado_por: auth.user.email ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("fecharAcerto error:", error);
    return { success: false, error: "Erro ao fechar o acerto." };
  }

  if (p.linhas.length > 0) {
    const { error: e2 } = await supabaseAdmin.from("acerto_linha").insert(
      p.linhas.map((l) => ({
        acerto_id: acerto.id,
        tipo: l.tipo,
        cobranca_id: l.cobranca_id,
        despesa_id: l.despesa_id,
        veiculo_id: l.veiculo_id,
        matricula_snapshot: l.matricula,
        descricao: l.descricao,
        valor: String(l.valor),
      })),
    );
    if (e2) {
      console.error("fecharAcerto linhas error:", e2);
      return { success: false, error: "Acerto criado, mas falharam as linhas." };
    }
  }

  revalidatePath("/admin/acertos");
  return { success: true, id: acerto.id };
}

export async function marcarAcertoPago(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin
    .from("acerto")
    .update({ estado: "pago" })
    .eq("id", id);
  if (error) return { success: false, error: "Erro ao marcar como pago." };

  revalidatePath("/admin/acertos");
  return { success: true };
}
