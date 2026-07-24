"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import type { Database } from "@/types/db";

type ProprietarioUpdate = Database["public"]["Tables"]["proprietario"]["Update"];

/**
 * Gestão de proprietários (parceiros-donos). Como toda a administração, cada
 * ação verifica a sessão — são endpoints HTTP públicos.
 */

export interface CriarProprietarioInput {
  nome: string;
  email?: string | null;
  telefone?: string | null;
  nif?: string | null;
  iban?: string | null;
  // numeric no Postgres → guardado como string, como os preços.
  comissao_valor?: string | number | null;
  eh_goscooters?: boolean;
  recebe_pagamento_direto?: boolean;
  tipo_parceiro?: "gerido" | "anunciante";
}

export async function criarProprietario(
  input: CriarProprietarioInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const nome = input.nome?.trim();
  if (!nome) return { success: false, error: "Nome é obrigatório." };

  const { data, error } = await supabaseAdmin
    .from("proprietario")
    .insert({
      nome,
      email: input.email?.trim() || null,
      telefone: input.telefone?.trim() || null,
      nif: input.nif?.trim() || null,
      iban: input.iban?.trim() || null,
      comissao_modelo: "percentagem",
      comissao_valor: input.comissao_valor != null ? String(input.comissao_valor) : null,
      eh_goscooters: input.eh_goscooters ?? false,
      recebe_pagamento_direto: input.recebe_pagamento_direto ?? false,
      tipo_parceiro: input.tipo_parceiro ?? "gerido",
    })
    .select("id")
    .single();

  if (error) {
    console.error("criarProprietario error:", error);
    return { success: false, error: "Erro ao criar proprietário." };
  }

  revalidatePath("/admin/proprietarios");
  return { success: true, id: data.id };
}

export async function atualizarProprietario(
  id: string,
  updates: ProprietarioUpdate,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin
    .from("proprietario")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("atualizarProprietario error:", error);
    return { success: false, error: "Erro ao atualizar proprietário." };
  }

  revalidatePath("/admin/proprietarios");
  revalidatePath("/admin/motas");
  return { success: true };
}

export async function eliminarProprietario(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  // Só elimina se não houver veículos ligados — evita órfãos silenciosos.
  const { count, error: countErr } = await supabaseAdmin
    .from("moto")
    .select("id", { count: "exact", head: true })
    .eq("proprietario_id", id);

  if (countErr) {
    console.error("eliminarProprietario count error:", countErr);
    return { success: false, error: "Não foi possível verificar os veículos associados." };
  }

  if (count && count > 0) {
    return {
      success: false,
      error: `Não é possível eliminar: tem ${count} veículo(s) associado(s).`,
    };
  }

  const { error } = await supabaseAdmin.from("proprietario").delete().eq("id", id);
  if (error) {
    console.error("eliminarProprietario error:", error);
    return { success: false, error: "Erro ao eliminar proprietário." };
  }

  revalidatePath("/admin/proprietarios");
  return { success: true };
}
