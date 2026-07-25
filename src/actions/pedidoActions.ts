"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { normalizarTelefone, paraE164 } from "@/lib/telefone";
import { notificar } from "@/lib/notificacoes";
import type { PedidoEstado } from "@/types/db";

export async function updatePedidoEstado(
  id: string,
  estado: PedidoEstado,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  try {
    const { error } = await supabaseAdmin
      .from("pedido_aluguer")
      .update({ estado })
      .eq("id", id);

    if (error) {
      console.error("Supabase update error:", error);
      return { success: false, error: "Erro ao atualizar pedido." };
    }

    revalidatePath("/admin/pedidos");

    return { success: true };
  } catch (err) {
    console.error("Error updating pedido:", err);
    return { success: false, error: "Erro inesperado." };
  }
}

/**
 * Converte um pedido do site numa JORNADA: liga (ou cria) o motorista, escreve a
 * ponte pedido→cliente (pedido_aluguer.motorista_id, hoje nunca preenchida),
 * fecha o funil e abre um pré-contrato ligado ao pedido. Idempotente: reutiliza o
 * motorista e o pré-contrato se já existirem.
 */
export async function converterPedidoEmJornada(
  pedidoId: string,
): Promise<{ success: boolean; contratoId?: string; motoristaId?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data: p } = await supabaseAdmin
    .from("pedido_aluguer")
    .select("id, nome, telefone, email, plataforma, motorista_id")
    .eq("id", pedidoId)
    .maybeSingle();
  if (!p) return { success: false, error: "Pedido não encontrado." };

  // Já convertido (ponte escrita): reutiliza a jornada ligada a este pedido, não
  // cria outra. Torna a conversão idempotente mesmo depois de o pré-contrato
  // avançar de estado.
  if (p.motorista_id) {
    const { data: jaC } = await supabaseAdmin
      .from("contrato_aluguer")
      .select("id")
      .eq("pedido_aluguer_id", pedidoId)
      .neq("estado", "cancelado")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { success: true, motoristaId: p.motorista_id ?? undefined, contratoId: jaC?.id };
  }

  // 1. Motorista: dedup por telefone; se não existe, cria (tolerando corrida 23505).
  const digitos = normalizarTelefone(p.telefone);
  const acharMotorista = async () =>
    (await supabaseAdmin.from("motorista").select("id").eq("telefone_digitos", digitos).maybeSingle()).data;

  let motoristaId: string;
  const existente = await acharMotorista();
  if (existente) {
    motoristaId = existente.id;
  } else {
    const { data: novo, error: eNovo } = await supabaseAdmin
      .from("motorista")
      .insert({
        nome: p.nome,
        telefone: p.telefone,
        telefone_digitos: digitos,
        telefone_e164: paraE164(p.telefone),
        email: p.email ?? null,
        plataforma: p.plataforma ?? null,
        origem: "site",
        estado: "lead",
      })
      .select("id")
      .single();
    if (novo) {
      motoristaId = novo.id;
    } else if (eNovo?.code === "23505") {
      // Corrida: outro pedido criou-o entretanto — reutiliza.
      const re = await acharMotorista();
      if (!re) return { success: false, error: "Erro ao criar o motorista." };
      motoristaId = re.id;
    } else {
      console.error("converterPedido motorista error:", eNovo);
      return { success: false, error: "Erro ao criar o motorista." };
    }
  }
  // Escreve a ponte e fecha o funil.
  await supabaseAdmin
    .from("pedido_aluguer")
    .update({ motorista_id: motoristaId, estado: "fechado" })
    .eq("id", pedidoId);

  // 2. Pré-contrato: reutiliza o aberto do motorista, ou cria um novo (tolerando
  //    a corrida no índice único contrato_um_pre_por_motorista).
  const acharPre = async () =>
    (await supabaseAdmin.from("contrato_aluguer").select("id, numero").eq("motorista_id", motoristaId).eq("estado", "pre_contrato").maybeSingle()).data;

  const preExistente = await acharPre();
  let contratoId = preExistente?.id ?? null;
  if (!contratoId) {
    const { data: c, error: eC } = await supabaseAdmin
      .from("contrato_aluguer")
      .insert({ motorista_id: motoristaId, estado: "pre_contrato", pedido_aluguer_id: pedidoId })
      .select("id, numero")
      .single();
    if (c) {
      contratoId = c.id;
      await notificar({
        tipo: "pre_contrato_sem_mota",
        titulo: "Pré-contrato à espera de mota",
        detalhe: `Jornada ${c.numero} (do pedido de ${p.nome}) — atribuir mota, preço e data.`,
        href: "/admin/contratos",
        entidade: "contrato",
        entidade_id: c.id,
      });
    } else if (eC?.code === "23505") {
      contratoId = (await acharPre())?.id ?? null; // corrida: reutiliza, sem duplicar a notificação
    } else {
      console.error("converterPedido pre_contrato error:", eC);
      return { success: false, error: "Erro ao abrir a jornada." };
    }
  }

  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/contratos");
  revalidatePath("/admin/motoristas");
  return { success: true, contratoId: contratoId ?? undefined, motoristaId };
}
