"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import type { Moto } from "@/types/db";

/**
 * Nota de segurança: Server Actions são endpoints HTTP públicos. Qualquer pessoa
 * pode invocá-las directamente, sem passar pela UI. Por isso cada uma verifica a
 * sessão — não basta esconder os botões no painel de administração.
 */

export async function updateMoto(
  id: string,
  updates: Partial<Omit<Moto, "id" | "created_at">>,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  try {
    const { error } = await supabaseAdmin
      .from("moto")
      .update(updates)
      .eq("id", id);

    if (error) {
      console.error("Supabase update error:", error);
      return { success: false, error: "Erro ao atualizar mota." };
    }

    revalidatePath("/admin/motas");
    revalidatePath("/");

    return { success: true };
  } catch (err) {
    console.error("Error updating moto:", err);
    return { success: false, error: "Erro inesperado." };
  }
}

export async function createMoto(
  data: Omit<Moto, "id" | "created_at">,
): Promise<{ success: boolean; error?: string; id?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

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

    revalidatePath("/admin/motas");
    revalidatePath("/");

    return { success: true, id: result.id };
  } catch (err) {
    console.error("Error creating moto:", err);
    return { success: false, error: "Erro inesperado." };
  }
}

export async function deleteMoto(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  try {
    const { error } = await supabaseAdmin.from("moto").delete().eq("id", id);

    if (error) {
      console.error("Supabase delete error:", error);
      return { success: false, error: "Erro ao eliminar mota." };
    }

    revalidatePath("/admin/motas");
    revalidatePath("/");

    return { success: true };
  } catch (err) {
    console.error("Error deleting moto:", err);
    return { success: false, error: "Erro inesperado." };
  }
}
