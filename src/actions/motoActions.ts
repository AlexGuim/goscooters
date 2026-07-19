"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Moto } from "@/types/db";

export async function updateMoto(
  id: string,
  updates: Partial<Omit<Moto, "id" | "created_at">>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin
      .from("moto")
      .update(updates)
      .eq("id", id);

    if (error) {
      console.error("Supabase update error:", error);
      return { success: false, error: "Erro ao atualizar mota." };
    }

    return { success: true };
  } catch (err) {
    console.error("Error updating moto:", err);
    return { success: false, error: "Erro inesperado." };
  }
}

export async function createMoto(
  data: Omit<Moto, "id" | "created_at">,
): Promise<{ success: boolean; error?: string; id?: string }> {
  try {
    const { data: result, error } = await supabaseAdmin
      .from("moto")
      .insert(data)
      .select("id")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return { success: false, error: "Erro ao criar mota." };
    }

    return { success: true, id: result.id };
  } catch (err) {
    console.error("Error creating moto:", err);
    return { success: false, error: "Erro inesperado." };
  }
}

export async function deleteMoto(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin
      .from("moto")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Supabase delete error:", error);
      return { success: false, error: "Erro ao eliminar mota." };
    }

    return { success: true };
  } catch (err) {
    console.error("Error deleting moto:", err);
    return { success: false, error: "Erro inesperado." };
  }
}
