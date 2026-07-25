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
