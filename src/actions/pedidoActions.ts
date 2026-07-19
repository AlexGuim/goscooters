"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
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
