"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PedidoEstado } from "@/types/db";

export async function updatePedidoEstado(
  id: string,
  estado: PedidoEstado,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin
      .from("pedido_aluguer")
      .update({ estado })
      .eq("id", id);

    if (error) {
      console.error("Supabase update error:", error);
      return { success: false, error: "Erro ao atualizar pedido." };
    }

    return { success: true };
  } catch (err) {
    console.error("Error updating pedido:", err);
    return { success: false, error: "Erro inesperado." };
  }
}
