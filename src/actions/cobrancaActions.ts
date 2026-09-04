"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import type { CobrancaPainel } from "@/app/(admin)/admin/(protected)/cobrancas/CobrancasList";

/**
 * Todas as cobranças cujo vencimento cai numa semana (de..ate, inclusive),
 * INCLUINDO as já pagas — é a folha de conferência semanal (quem pagou, quem
 * falta). Exclui só as anuladas. Devolve já com os nomes resolvidos.
 */
export async function cobrancasDaSemana(de: string, ate: string): Promise<CobrancaPainel[]> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return [];

  const [cobRes, motsRes, motosRes, donosRes] = await Promise.all([
    supabaseAdmin
      .from("vw_cobranca_estado")
      .select("*")
      .gte("data_vencimento", de)
      .lte("data_vencimento", ate)
      .neq("estado_liquidacao", "anulada")
      .order("data_vencimento", { ascending: true }),
    supabaseAdmin.from("motorista").select("id, nome, telefone, telefone_e164, idioma_preferido"),
    supabaseAdmin.from("moto").select("id, matricula, modelo"),
    supabaseAdmin.from("proprietario").select("*"),
  ]);

  const mot = new Map((motsRes.data ?? []).map((m) => [m.id, m]));
  const moto = new Map((motosRes.data ?? []).map((m) => [m.id, m]));
  const dono = new Map((donosRes.data ?? []).map((d) => [d.id, d]));

  return (cobRes.data ?? []).map((c: Record<string, unknown>) => {
    const m = mot.get(c.motorista_id as string);
    const v = moto.get(c.veiculo_id as string);
    const d = c.proprietario_id ? dono.get(c.proprietario_id as string) : undefined;
    return {
      id: c.id as string,
      numero: c.numero as string,
      contrato_id: c.contrato_id as string,
      motorista_id: c.motorista_id as string,
      motorista_nome: m?.nome ?? "—",
      motorista_telefone: m?.telefone ?? null,
      motorista_e164: m?.telefone_e164 ?? null,
      motorista_idioma: m?.idioma_preferido ?? null,
      veiculo_matricula: v?.matricula ?? "—",
      proprietario_id: (c.proprietario_id as string) ?? null,
      proprietario_nome: d?.nome ?? "Sem proprietário",
      proprietario_recebe_direto: !!d?.recebe_pagamento_direto,
      periodo_inicio: c.periodo_inicio as string,
      periodo_fim: c.periodo_fim as string,
      data_vencimento: c.data_vencimento as string,
      valor_devido: String(c.valor_devido),
      valor_pago: String(c.valor_pago),
      desconto: String(c.desconto ?? 0),
      desconto_motivo: (c.desconto_motivo as string) ?? null,
      em_falta: String(c.em_falta),
      // A caução é cobrada em mão na entrega — nunca "em atraso" (só por liquidar).
      em_atraso: Boolean(c.em_atraso) && c.tipo !== "caucao",
      estado_liquidacao: c.estado_liquidacao as CobrancaPainel["estado_liquidacao"],
      tipo: (c.tipo as CobrancaPainel["tipo"]) ?? "renda",
    };
  });
}

/**
 * Marca cobranças como INCOBRÁVEIS — a semana foi usada, era devida, e o
 * motorista não vai pagar. É uma perda assumida, não um apagar de dívida:
 * fica registada com data e motivo para se poder somar depois.
 *
 * Não mexe em dinheiro nenhum. Como o acerto é a regime de caixa, o valor já
 * não estava a ser contado como receita — isto só o tira de "quem me deve" e
 * passa a nomeá-lo como perda.
 *
 * Recusa cobranças já pagas: uma semana liquidada não é perda. E recusa as
 * anuladas (nunca foram devidas — dar isso como perda inflacionaria o prejuízo).
 */
export async function marcarIncobravel(
  cobrancaIds: string[],
  motivo: string,
): Promise<{ success: boolean; marcadas?: number; total?: number; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const ids = [...new Set((cobrancaIds ?? []).filter(Boolean))];
  if (!ids.length) return { success: false, error: "Escolhe pelo menos uma semana." };
  const razao = motivo?.trim();
  if (!razao) return { success: false, error: "Explica porque é incobrável (fica no registo)." };

  const { data: cobs, error: eLer } = await supabaseAdmin
    .from("cobranca")
    .select("id, valor_devido, valor_pago, desconto, estado_liquidacao")
    .in("id", ids);
  if (eLer) {
    console.error("marcarIncobravel ler error:", eLer);
    return { success: false, error: "Erro ao ler as cobranças." };
  }

  const elegiveis = (cobs ?? []).filter((c) =>
    ["por_liquidar", "parcial"].includes(c.estado_liquidacao as string),
  );
  if (!elegiveis.length) {
    return { success: false, error: "Nenhuma das semanas escolhidas está por liquidar." };
  }

  const total = elegiveis.reduce(
    (t, c) =>
      t + Math.max(Number(c.valor_devido) - Number(c.desconto ?? 0) - Number(c.valor_pago), 0),
    0,
  );

  const { data, error } = await supabaseAdmin
    .from("cobranca")
    .update({
      estado_liquidacao: "incobravel",
      incobravel_em: new Date().toISOString(),
      incobravel_motivo: razao,
    })
    .in(
      "id",
      elegiveis.map((c) => c.id),
    )
    .select("id");
  if (error) {
    console.error("marcarIncobravel error:", error);
    return { success: false, error: "Erro ao marcar como incobrável." };
  }

  revalidatePath("/admin/cobrancas");
  revalidatePath("/admin/acertos");
  return { success: true, marcadas: data?.length ?? 0, total: Math.round(total * 100) / 100 };
}

/** Desfaz a marcação de perda: a semana volta a ser dívida a cobrar. */
export async function reverterIncobravel(
  cobrancaId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  // Voltar a 'por_liquidar' não basta: o gatilho só reavalia quando o
  // valor_devido ou o desconto mudam. Escreve-se o estado correto de uma vez.
  const { data: c } = await supabaseAdmin
    .from("cobranca")
    .select("valor_devido, valor_pago, desconto")
    .eq("id", cobrancaId)
    .maybeSingle();
  if (!c) return { success: false, error: "Cobrança não encontrada." };

  const pago = Number(c.valor_pago);
  const emAberto = Number(c.valor_devido) - Number(c.desconto ?? 0);
  const estado = pago >= emAberto ? "liquidada" : pago > 0 ? "parcial" : "por_liquidar";

  const { error } = await supabaseAdmin
    .from("cobranca")
    .update({ estado_liquidacao: estado, incobravel_em: null, incobravel_motivo: null })
    .eq("id", cobrancaId)
    .eq("estado_liquidacao", "incobravel");
  if (error) {
    console.error("reverterIncobravel error:", error);
    return { success: false, error: "Erro ao reverter." };
  }
  revalidatePath("/admin/cobrancas");
  revalidatePath("/admin/acertos");
  return { success: true };
}

/**
 * Aplica um DESCONTO a uma semana — o serviço não foi prestado (moto avariada,
 * dias sem rodar), por isso aquele valor nunca chegou a ser devido.
 *
 * Não é perda nem calote: o preço contratado fica intacto em `valor_devido` e o
 * abatimento à parte, para a diferença ser sempre explicável. O gatilho da base
 * de dados reavalia o estado sozinho — uma semana de 55 € com 15 € de desconto
 * fica LIQUIDADA quando entram 40 €, em vez de ficar eternamente a pedir 15 €.
 *
 * `desconto = 0` remove o abatimento.
 */
export async function aplicarDesconto(
  cobrancaId: string,
  desconto: number,
  motivo: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const valor = Number(desconto);
  if (!Number.isFinite(valor) || valor < 0) {
    return { success: false, error: "Indica um desconto válido (0 ou mais)." };
  }
  const razao = motivo?.trim();
  if (valor > 0 && !razao) {
    return { success: false, error: "Explica o desconto (ex.: 4 dias parada por avaria)." };
  }

  const { data: c } = await supabaseAdmin
    .from("cobranca")
    .select("valor_devido, estado_liquidacao")
    .eq("id", cobrancaId)
    .maybeSingle();
  if (!c) return { success: false, error: "Cobrança não encontrada." };
  if (valor > Number(c.valor_devido)) {
    return { success: false, error: "O desconto não pode ser maior do que o valor da semana." };
  }
  if (["anulada", "incobravel"].includes(c.estado_liquidacao as string)) {
    return { success: false, error: "Esta semana está anulada ou dada como perda — reverte antes." };
  }

  const { error } = await supabaseAdmin
    .from("cobranca")
    .update({ desconto: valor.toFixed(2), desconto_motivo: valor > 0 ? razao : null })
    .eq("id", cobrancaId);
  if (error) {
    console.error("aplicarDesconto error:", error);
    return { success: false, error: "Erro ao aplicar o desconto." };
  }
  revalidatePath("/admin/cobrancas");
  revalidatePath("/admin/acertos");
  return { success: true };
}
