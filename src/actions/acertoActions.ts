"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { formatarPreco } from "@/lib/precos";
import { notificar } from "@/lib/notificacoes";
import { rotuloSemanaMes, mesDaSemana } from "@/lib/datas";
import { ehNomePlaceholder } from "@/lib/nomeMotorista";
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
  periodo_inicio: string | null; // só nas rendas — referência da semana
  valor: number; // receita + ; despesa/comissão −
}

/** Renda do mês que ficou POR PAGAR — informativa, NÃO entra nos totais do acerto. */
export interface PendentePreview {
  matricula: string | null;
  semana: string; // rótulo "Semana N de <mês>"
  motorista: string | null;
  valor: number; // em falta (devido − pago)
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
  /** Rendas do mês por pagar (visibilidade; fora dos totais). */
  pendentes: PendentePreview[];
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
  const pendentes: PendentePreview[] = [];
  let receita = 0;
  let receitaGs = 0; // parte cobrada pela GoScooters (o resto foi direto ao parceiro)
  const comissaoPorVeiculo = new Map<string, number>();

  if (veicIds.length > 0) {
    const { data: cobs } = await supabaseAdmin
      .from("cobranca")
      .select("id, veiculo_id, motorista_id, valor_pago, valor_devido, estado_liquidacao, periodo_inicio, periodo_fim, data_vencimento")
      .in("veiculo_id", veicIds)
      .eq("tipo", "renda") // só renda gera comissão; caução/extra são reembolso
      .gte("data_vencimento", inicio)
      .lte("data_vencimento", fim);

    // A que MÊS pertence cada semana decide-se pela sua quarta-feira (igual ao
    // rótulo em Cobranças), não pela janela de datas — que assumia o vencimento
    // ao domingo e cortava a 5.ª semana quando o vencimento calhava a meio da
    // semana (contratos que começam noutro dia). Assim o acerto nunca diverge da
    // lista de Cobranças.
    const doMes = (cobs ?? []).filter((c) => mesDaSemana(c.data_vencimento) === competencia);
    const pagas = doMes.filter((c) => Number(c.valor_pago) > 0);
    const cobIds = pagas.map((c) => c.id);

    // Quanto de cada renda foi recebido PELA GoScooters (o resto entrou na conta
    // do parceiro). Vem das alocações de pagamento, pelo recebido_por de cada um.
    const gsPorCobranca = new Map<string, number>();
    // Tolerância à migração: se a coluna recebido_por ainda não existir, trata-se
    // tudo como recebido pela GoScooters (comportamento anterior) em vez de partir.
    let semRecebidoPor = false;
    if (cobIds.length > 0) {
      const { data: alocs, error: alocErr } = await supabaseAdmin
        .from("pagamento_cobranca")
        .select("cobranca_id, valor_alocado, pagamento:pagamento_id(recebido_por)")
        .in("cobranca_id", cobIds);
      if (alocErr) {
        semRecebidoPor = true;
      } else {
        for (const a of alocs ?? []) {
          // O embed do pagamento pode vir como objeto ou array conforme a versão.
          const pj = Array.isArray(a.pagamento) ? a.pagamento[0] : a.pagamento;
          const rp = (pj as { recebido_por?: string } | null)?.recebido_por ?? "goscooters";
          if (rp === "goscooters") {
            const k = a.cobranca_id as string;
            gsPorCobranca.set(k, (gsPorCobranca.get(k) ?? 0) + Number(a.valor_alocado));
          }
        }
      }
    }

    // 1.º nome do motorista que pagou cada semana — ajuda o parceiro a saber quem
    // esteve com a moto (uma moto pode trocar de motorista no mês). Só o 1.º nome
    // (minimização RGPD, como no portal); o placeholder "por confirmar" não entra.
    const nomeMot = new Map<string, string>();
    const motIds = [...new Set(doMes.filter((c) => c.motorista_id).map((c) => c.motorista_id as string))];
    if (motIds.length > 0) {
      const { data: mots } = await supabaseAdmin.from("motorista").select("id, nome").in("id", motIds);
      for (const m of mots ?? []) {
        if (!ehNomePlaceholder(m.nome)) nomeMot.set(m.id as string, (m.nome as string).trim().split(/\s+/)[0]);
      }
    }

    // Ordena por veículo e por período. A semana mostra-se pelo rótulo real do mês
    // (rotuloSemanaMes: "Semana 5 de julho"), o MESMO que aparece em Cobranças —
    // não um contador sequencial. Assim os gaps ficam visíveis (uma moto com as
    // semanas 2, 4, 5 mostra-se assim, revelando a 1 e a 3 em falta).
    const pagasOrd = [...pagas].sort(
      (a, b) =>
        (a.veiculo_id ?? "").localeCompare(b.veiculo_id ?? "") ||
        a.periodo_inicio.localeCompare(b.periodo_inicio),
    );
    for (const c of pagasOrd) {
      const pago = Number(c.valor_pago);
      const gs = semRecebidoPor ? pago : Math.min(gsPorCobranca.get(c.id) ?? 0, pago);
      receita += pago;
      receitaGs += gs;
      const taxa = taxaDe.get(c.veiculo_id) ?? taxaBase;
      const com = Math.round(pago * taxa) / 100;
      comissaoPorVeiculo.set(
        c.veiculo_id,
        (comissaoPorVeiculo.get(c.veiculo_id) ?? 0) + com,
      );
      const canal = gs >= pago - 0.005 ? "GoScooters" : gs <= 0.005 ? "parceiro" : "misto";
      const nome = c.motorista_id ? nomeMot.get(c.motorista_id) : undefined;
      linhas.push({
        tipo: "receita",
        descricao: `${rotuloSemanaMes(c.data_vencimento)}${nome ? ` · ${nome}` : ""} · recebido: ${canal}`,
        matricula: matDe.get(c.veiculo_id) ?? null,
        veiculo_id: c.veiculo_id,
        cobranca_id: c.id,
        despesa_id: null,
        periodo_inicio: c.periodo_inicio,
        valor: pago,
      });
    }

    // Rendas do mês que ficaram POR PAGAR (fora dos totais — só visibilidade, para
    // o parceiro ver o que não entrou por não ter sido pago). Exclui anuladas
    // (contrato acabou) e isentas; mostra o que falta (devido − pago).
    const porPagar = doMes
      .filter((c) => {
        const est = c.estado_liquidacao as string | null;
        return est !== "anulada" && est !== "isenta" && Number(c.valor_pago) < Number(c.valor_devido);
      })
      .sort(
        (a, b) =>
          (a.veiculo_id ?? "").localeCompare(b.veiculo_id ?? "") ||
          a.periodo_inicio.localeCompare(b.periodo_inicio),
      );
    for (const c of porPagar) {
      pendentes.push({
        matricula: matDe.get(c.veiculo_id) ?? null,
        semana: rotuloSemanaMes(c.data_vencimento),
        motorista: c.motorista_id ? nomeMot.get(c.motorista_id) ?? null : null,
        valor: Math.round((Number(c.valor_devido) - Number(c.valor_pago)) * 100) / 100,
      });
    }
  }

  // Renda que foi direto ao parceiro (não à GoScooters): deduz-se, para o extrato
  // mostrar as rendas recebidas E o somatório bater certo com o líquido.
  const receitaParceiro = Math.round((receita - receitaGs) * 100) / 100;
  if (receitaParceiro > 0.005) {
    linhas.push({
      tipo: "receita",
      descricao: "Renda recebida diretamente pelo parceiro (fora da GoScooters)",
      matricula: null,
      veiculo_id: null,
      cobranca_id: null,
      despesa_id: null,
      periodo_inicio: null,
      valor: -receitaParceiro,
    });
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
      periodo_inicio: null,
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
      periodo_inicio: null,
      valor: -v,
    });
  }

  const receitaTotal = Math.round(receita * 100) / 100;
  const receitaGoscooters = Math.round(receitaGs * 100) / 100;
  comissaoTotal = Math.round(comissaoTotal * 100) / 100;
  despesaTotal = Math.round(despesaTotal * 100) / 100;

  // Líquido = receita cobrada pela GoScooters − comissão − despesas. Se parte (ou
  // tudo) foi direto ao parceiro, o líquido desce e pode ficar negativo — nesse
  // caso é o que o parceiro DEVE à GoScooters. pago_direto = houve renda direta.
  const pagoDireto = receitaParceiro > 0.005;
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
      pendentes,
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

  await notificar({
    tipo: "acerto_por_pagar",
    titulo: "Acerto fechado — por acertar com o parceiro",
    detalhe: `${p.proprietario_nome} · ${competencia} · líquido ${formatarPreco(p.liquido)}`,
    href: `/admin/acertos/${acerto.id}`,
    entidade: "acerto",
    entidade_id: acerto.id,
  });

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
