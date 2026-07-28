"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import type { Database, MotoEstado, EstadoOperacional } from "@/types/db";

// Estados de contrato em que a moto está FORA (com motorista): não pode aparecer
// como "disponível" no portal nem no site.
const CONTRATO_OCUPA = ["ativo", "pendente_fecho"] as const;

/** O plano operacional (portal/frota) que corresponde ao estado de catálogo. */
function operacionalDe(estado: MotoEstado): EstadoOperacional {
  return estado === "alugada" ? "ocupado" : estado === "manutencao" ? "manutencao" : "disponivel";
}

type MotoInsert = Database["public"]["Tables"]["moto"]["Insert"];
type MotoUpdate = Database["public"]["Tables"]["moto"]["Update"];

/**
 * Nota de segurança: Server Actions são endpoints HTTP públicos. Qualquer pessoa
 * pode invocá-las directamente, sem passar pela UI. Por isso cada uma verifica a
 * sessão — não basta esconder os botões no painel de administração.
 */

export async function updateMoto(
  id: string,
  updates: MotoUpdate,
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
  data: MotoInsert,
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

/**
 * Define o estado da moto SINCRONIZANDO os dois planos (catálogo `estado` +
 * operacional `estado_operacional`), para o portal do parceiro e o site nunca
 * divergirem. Casamento com o contrato: não deixa marcar disponível/manutenção
 * uma moto com contrato ATIVO — nesse caso é preciso terminar o contrato primeiro.
 */
export async function definirEstadoMoto(
  id: string,
  estado: MotoEstado,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (estado !== "alugada") {
    const { data: ocupado } = await supabaseAdmin
      .from("contrato_aluguer")
      .select("numero")
      .eq("veiculo_id", id)
      .in("estado", [...CONTRATO_OCUPA])
      .limit(1)
      .maybeSingle();
    if (ocupado) {
      return {
        success: false,
        error: `Esta moto tem o contrato ${ocupado.numero} em curso. Termina/recolhe o contrato para a libertar.`,
      };
    }
  }

  const { error } = await supabaseAdmin
    .from("moto")
    .update({ estado, estado_operacional: operacionalDe(estado) })
    .eq("id", id);
  if (error) {
    console.error("definirEstadoMoto error:", error);
    return { success: false, error: "Erro ao atualizar o estado." };
  }
  revalidatePath("/admin/motas");
  revalidatePath("/");
  return { success: true };
}

/**
 * Reconcilia o estado das motos com os contratos ATIVOS: qualquer moto que tenha
 * um contrato em curso mas não esteja "ocupada" é corrigida (operacional=ocupado
 * e catálogo→alugada se estava disponível). Não liberta automaticamente — libertar
 * passa sempre pela recolha/fim do contrato. Serve para sarar divergências antigas
 * (ex.: importações) sem esperar por um novo evento de contrato.
 */
export async function reconciliarEstadosMotas(): Promise<{
  success: boolean;
  corrigidas?: number;
  error?: string;
}> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data: contratos } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("veiculo_id")
    .in("estado", [...CONTRATO_OCUPA])
    .not("veiculo_id", "is", null);
  const idsOcupados = [...new Set((contratos ?? []).map((c) => c.veiculo_id as string))];
  if (idsOcupados.length === 0) return { success: true, corrigidas: 0 };

  const { data: motos } = await supabaseAdmin
    .from("moto")
    .select("id, estado_operacional")
    .in("id", idsOcupados);
  const desalinhadas = (motos ?? [])
    .filter((m) => m.estado_operacional !== "ocupado")
    .map((m) => m.id);
  if (desalinhadas.length === 0) return { success: true, corrigidas: 0 };

  await supabaseAdmin.from("moto").update({ estado_operacional: "ocupado" }).in("id", desalinhadas);
  // Catálogo: só disponivel→alugada (nunca mexe em 'manutencao').
  await supabaseAdmin
    .from("moto")
    .update({ estado: "alugada" })
    .in("id", desalinhadas)
    .eq("estado", "disponivel");

  revalidatePath("/admin/motas");
  revalidatePath("/");
  return { success: true, corrigidas: desalinhadas.length };
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
