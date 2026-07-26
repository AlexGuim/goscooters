"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";

/** Marca uma notificação como resolvida (feita). */
export async function marcarNotificacaoFeita(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin
    .from("notificacao")
    .update({ estado: "feita", feita_em: new Date().toISOString(), feita_por: auth.user.id })
    .eq("id", id);
  if (error) {
    console.error("marcarNotificacaoFeita:", error);
    return { success: false, error: "Erro ao atualizar a notificação." };
  }
  revalidatePath("/admin/notificacoes");
  return { success: true };
}

/**
 * Validação HUMANA da identidade de um motorista: resolve a notificação
 * "documentos por validar" (kyc_por_validar) num clique a partir da própria ficha,
 * sem o gestor ter de ir às notificações. É a confirmação explícita de que os
 * documentos foram revistos (o que a completude de campos, sozinha, não garante).
 */
export async function validarIdentidadeMotorista(
  motoristaId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin
    .from("notificacao")
    .update({ estado: "feita", feita_em: new Date().toISOString(), feita_por: auth.user.id })
    .eq("entidade_id", motoristaId)
    .eq("tipo", "kyc_por_validar")
    .neq("estado", "feita");
  if (error) {
    console.error("validarIdentidadeMotorista:", error);
    return { success: false, error: "Erro ao validar a identidade." };
  }
  revalidatePath("/admin/motoristas");
  revalidatePath("/admin/notificacoes");
  return { success: true };
}

/** Marca todas as 'nova' como 'lida' (limpa o contador do sino). */
export async function marcarTodasLidas(): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin
    .from("notificacao")
    .update({ estado: "lida" })
    .eq("estado", "nova");
  if (error) {
    console.error("marcarTodasLidas:", error);
    return { success: false, error: "Erro." };
  }
  revalidatePath("/admin/notificacoes");
  return { success: true };
}
