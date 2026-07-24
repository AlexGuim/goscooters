"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import type { ContratoEstado, Database, Periodicidade } from "@/types/db";

type ContratoUpdate = Database["public"]["Tables"]["contrato_aluguer"]["Update"];

export interface CriarContratoInput {
  motorista_id: string;
  veiculo_id: string;
  proprietario_id?: string | null;
  periodicidade: Periodicidade;
  dia_vencimento?: number | null;
  preco_periodo: string;
  caucao?: string | null;
  data_inicio: string;
  ancora_vencimento?: string | null;
  estado: ContratoEstado;
  observacoes?: string | null;
}

function validar(
  input: Partial<CriarContratoInput>,
): string | null {
  if (input.preco_periodo !== undefined) {
    const n = Number(input.preco_periodo);
    if (Number.isNaN(n) || n <= 0) return "Indica um preço válido.";
  }
  return null;
}

export async function criarContrato(
  input: CriarContratoInput,
): Promise<{ success: boolean; id?: string; numero?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!input.motorista_id) return { success: false, error: "Cliente é obrigatório." };
  if (!input.veiculo_id) return { success: false, error: "Veículo é obrigatório." };
  if (!input.data_inicio) return { success: false, error: "Data de início é obrigatória." };
  const erro = validar(input);
  if (erro) return { success: false, error: erro };

  const { data, error } = await supabaseAdmin
    .from("contrato_aluguer")
    .insert({ ...input, proprietario_id: input.proprietario_id ?? null })
    .select("id, numero")
    .single();

  if (error) {
    console.error("criarContrato error:", error);
    return { success: false, error: "Erro ao criar contrato." };
  }

  // Um contrato ativo ocupa o veículo.
  if (input.estado === "ativo") {
    await supabaseAdmin
      .from("moto")
      .update({ estado_operacional: "ocupado" })
      .eq("id", input.veiculo_id);
  }

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/motas");
  return { success: true, id: data.id, numero: data.numero };
}

export async function atualizarContrato(
  id: string,
  updates: ContratoUpdate,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const erro = validar(updates as Partial<CriarContratoInput>);
  if (erro) return { success: false, error: erro };

  const { error } = await supabaseAdmin
    .from("contrato_aluguer")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("atualizarContrato error:", error);
    return { success: false, error: "Erro ao atualizar contrato." };
  }

  // Ao concluir/cancelar, liberta o veículo.
  if (updates.estado && updates.veiculo_id) {
    if (updates.estado === "concluido" || updates.estado === "cancelado") {
      await supabaseAdmin
        .from("moto")
        .update({ estado_operacional: "disponivel" })
        .eq("id", updates.veiculo_id);
    } else if (updates.estado === "ativo") {
      await supabaseAdmin
        .from("moto")
        .update({ estado_operacional: "ocupado" })
        .eq("id", updates.veiculo_id);
    }
  }

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/motas");
  return { success: true };
}

/**
 * Termina um contrato: marca-o como concluído na data de fim, ANULA as cobranças
 * futuras ainda por pagar (semanas que já não vão ser usadas — o modelo é
 * pré-pago) e liberta o veículo. As semanas já iniciadas/pagas mantêm-se (dívida
 * real). É o "evento de fim" que trava a geração rolante.
 */
export async function terminarContrato(
  id: string,
  dataFim: string,
): Promise<{ success: boolean; anuladas?: number; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!dataFim) return { success: false, error: "Indica a data de fim do contrato." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
    return { success: false, error: "Data inválida (usa AAAA-MM-DD)." };
  }

  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("veiculo_id")
    .eq("id", id)
    .maybeSingle();

  // 1.º concluir: fecha já a janela de geração rolante (fn_gerar_cobrancas só
  // gera para ativo/pendente_fecho), evitando corridas com o cron.
  const { error } = await supabaseAdmin
    .from("contrato_aluguer")
    .update({ estado: "concluido", data_fim: dataFim })
    .eq("id", id);
  if (error) {
    console.error("terminarContrato error:", error);
    return { success: false, error: "Erro ao terminar o contrato." };
  }

  // 2.º anular as semanas FUTURAS por liquidar (início depois do fim). As já
  // pagas/parciais mantêm-se (dinheiro real ou dívida por uma semana usada).
  const { data: anuladasData, error: anulErr } = await supabaseAdmin
    .from("cobranca")
    .update({ estado_liquidacao: "anulada" })
    .eq("contrato_id", id)
    .eq("estado_liquidacao", "por_liquidar")
    .gt("periodo_inicio", dataFim)
    .select("id");
  if (anulErr) {
    console.error("terminarContrato anular error:", anulErr);
    // O contrato já ficou concluído (não gera mais); as cobranças futuras
    // podem ser anuladas manualmente. Não revertemos.
  }

  if (c?.veiculo_id) {
    await supabaseAdmin
      .from("moto")
      .update({ estado_operacional: "disponivel" })
      .eq("id", c.veiculo_id);
  }

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/motas");
  revalidatePath("/admin/cobrancas");
  return { success: true, anuladas: anuladasData?.length ?? 0 };
}

/**
 * Inicia (ou estende) a faturação de um contrato: fixa a âncora do 1.º
 * vencimento, se ainda não existir, e materializa as cobranças até `ate`.
 */
export async function gerarCobrancas(
  contratoId: string,
  ate: string,
  ancora?: string,
): Promise<{ success: boolean; geradas?: number; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (ancora) {
    const { error } = await supabaseAdmin
      .from("contrato_aluguer")
      .update({ ancora_vencimento: ancora })
      .eq("id", contratoId);
    if (error) {
      console.error("gerarCobrancas anchor error:", error);
      return { success: false, error: "Erro ao fixar a data de início da faturação." };
    }
  }

  const { data, error } = await supabaseAdmin.rpc("fn_gerar_cobrancas", {
    p_contrato_id: contratoId,
    p_ate: ate,
  });

  if (error) {
    console.error("gerarCobrancas rpc error:", error);
    return { success: false, error: "Erro ao gerar as cobranças." };
  }

  revalidatePath("/admin/contratos");
  return { success: true, geradas: data ?? 0 };
}
