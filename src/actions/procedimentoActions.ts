"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import {
  avaliarProcedimentos,
  type ContextoEvento,
  type ResultadoProcedimento,
} from "@/lib/procedimentosMotor";
import type { Database, Procedimento, ProcedimentoGatilho } from "@/types/db";

type ProcedimentoInsert = Database["public"]["Tables"]["procedimento"]["Insert"];
type ProcedimentoUpdate = Database["public"]["Tables"]["procedimento"]["Update"];

export async function listarProcedimentos(): Promise<Procedimento[]> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return [];
  const { data } = await supabaseAdmin
    .from("procedimento")
    .select("*")
    .order("gatilho", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as Procedimento[];
}

export async function criarProcedimento(
  input: ProcedimentoInsert,
): Promise<{ success: boolean; procedimento?: Procedimento; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.nome?.trim()) return { success: false, error: "Dá um nome ao procedimento." };
  const { data, error } = await supabaseAdmin.from("procedimento").insert(input).select("*").single();
  if (error || !data) {
    console.error("criarProcedimento error:", error);
    return { success: false, error: "Erro ao criar o procedimento." };
  }
  revalidatePath("/admin/procedimentos");
  return { success: true, procedimento: data as Procedimento };
}

export async function atualizarProcedimento(
  id: string,
  updates: ProcedimentoUpdate,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  const { error } = await supabaseAdmin.from("procedimento").update(updates).eq("id", id);
  if (error) {
    console.error("atualizarProcedimento error:", error);
    return { success: false, error: "Erro ao atualizar o procedimento." };
  }
  revalidatePath("/admin/procedimentos");
  return { success: true };
}

export async function apagarProcedimento(id: string): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  const { error } = await supabaseAdmin.from("procedimento").delete().eq("id", id);
  if (error) {
    console.error("apagarProcedimento error:", error);
    return { success: false, error: "Erro ao apagar o procedimento." };
  }
  revalidatePath("/admin/procedimentos");
  return { success: true };
}

/** Corre os procedimentos de um evento (chamado pelo intake após o registo). */
export async function executarProcedimentos(
  gatilho: ProcedimentoGatilho,
  ctx: ContextoEvento,
): Promise<{ success: boolean; resultados?: ResultadoProcedimento[]; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  const resultados = await avaliarProcedimentos(gatilho, ctx);
  return { success: true, resultados };
}
