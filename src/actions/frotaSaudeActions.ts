"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import type { Database, Seguro, Manutencao } from "@/types/db";

type SeguroInsert = Database["public"]["Tables"]["seguro"]["Insert"];
type SeguroUpdate = Database["public"]["Tables"]["seguro"]["Update"];
type ManutencaoInsert = Database["public"]["Tables"]["manutencao"]["Insert"];

/**
 * "Saúde" da frota: seguros (apólices) e manutenções por veículo. Fonte de dados
 * para o painel da moto e, mais tarde, para as ferramentas do agente de IA
 * (ex.: "que seguros expiram este mês?", "que motos precisam de pneu?").
 *
 * Nota de segurança: Server Actions são endpoints HTTP públicos — cada uma
 * revalida a sessão de admin, não basta esconder os botões.
 */

/** Seguros + manutenções de uma moto, para o painel de saúde. */
export async function saudeMoto(
  motoId: string,
): Promise<{ success: boolean; seguros?: Seguro[]; manutencoes?: Manutencao[]; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const [segRes, manRes] = await Promise.all([
    supabaseAdmin
      .from("seguro")
      .select("*")
      .eq("veiculo_id", motoId)
      .order("data_fim", { ascending: false }),
    supabaseAdmin
      .from("manutencao")
      .select("*")
      .eq("veiculo_id", motoId)
      .order("data", { ascending: false }),
  ]);

  if (segRes.error || manRes.error) {
    console.error("saudeMoto error:", segRes.error ?? manRes.error);
    return { success: false, error: "Erro ao carregar seguros/manutenções." };
  }
  return {
    success: true,
    seguros: (segRes.data ?? []) as Seguro[],
    manutencoes: (manRes.data ?? []) as Manutencao[],
  };
}

export async function criarSeguro(
  input: SeguroInsert,
): Promise<{ success: boolean; seguro?: Seguro; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.veiculo_id || !input.data_fim) {
    return { success: false, error: "Veículo e data de fim são obrigatórios." };
  }

  const { data, error } = await supabaseAdmin.from("seguro").insert(input).select("*").single();
  if (error || !data) {
    console.error("criarSeguro error:", error);
    return { success: false, error: "Erro ao gravar o seguro." };
  }
  revalidatePath("/admin/motas");
  return { success: true, seguro: data as Seguro };
}

export async function atualizarSeguro(
  id: string,
  updates: SeguroUpdate,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin.from("seguro").update(updates).eq("id", id);
  if (error) {
    console.error("atualizarSeguro error:", error);
    return { success: false, error: "Erro ao atualizar o seguro." };
  }
  revalidatePath("/admin/motas");
  return { success: true };
}

export async function apagarSeguro(id: string): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin.from("seguro").delete().eq("id", id);
  if (error) {
    console.error("apagarSeguro error:", error);
    return { success: false, error: "Erro ao apagar o seguro." };
  }
  revalidatePath("/admin/motas");
  return { success: true };
}

export async function criarManutencao(
  input: ManutencaoInsert,
): Promise<{ success: boolean; manutencao?: Manutencao; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.veiculo_id) return { success: false, error: "Veículo obrigatório." };

  const { data, error } = await supabaseAdmin.from("manutencao").insert(input).select("*").single();
  if (error || !data) {
    console.error("criarManutencao error:", error);
    return { success: false, error: "Erro ao gravar a manutenção." };
  }
  revalidatePath("/admin/motas");
  return { success: true, manutencao: data as Manutencao };
}

export async function apagarManutencao(id: string): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin.from("manutencao").delete().eq("id", id);
  if (error) {
    console.error("apagarManutencao error:", error);
    return { success: false, error: "Erro ao apagar a manutenção." };
  }
  revalidatePath("/admin/motas");
  return { success: true };
}
