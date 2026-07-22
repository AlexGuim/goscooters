"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { normalizarTelefone } from "@/lib/telefone";
import type { AvaliacaoTipo, Avaliacao, Motorista } from "@/types/db";

/**
 * Registo privado de motoristas. Como toda a administração, cada ação verifica a
 * sessão — são endpoints HTTP públicos, não bastam botões escondidos.
 */

export interface MotoristaComResumo extends Motorista {
  positivas: number;
  negativas: number;
}

/** Resumo de um motorista pelo número de telefone, ou null se não existir. */
export async function procurarMotoristaPorTelefone(
  telefone: string,
): Promise<{ ok: boolean; motorista?: MotoristaComResumo | null; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const digitos = normalizarTelefone(telefone);
  if (!digitos) return { ok: true, motorista: null };

  const { data, error } = await supabaseAdmin
    .from("motorista")
    .select("*, avaliacao(tipo)")
    .eq("telefone_digitos", digitos)
    .maybeSingle();

  if (error) {
    console.error("procurarMotoristaPorTelefone error:", error);
    return { ok: false, error: "Erro ao procurar motorista." };
  }

  if (!data) return { ok: true, motorista: null };

  const registo = data as Motorista & { avaliacao?: { tipo: AvaliacaoTipo }[] };
  const avaliacoes = registo.avaliacao ?? [];

  return {
    ok: true,
    motorista: {
      ...(registo as Motorista),
      positivas: avaliacoes.filter((a) => a.tipo === "positiva").length,
      negativas: avaliacoes.filter((a) => a.tipo === "negativa").length,
    },
  };
}

export interface CriarMotoristaInput {
  nome: string;
  telefone: string;
  email?: string;
  plataforma?: string;
  notas?: string;
}

export async function criarMotorista(
  input: CriarMotoristaInput,
): Promise<{ success: boolean; id?: string; error?: string; jaExistiaId?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const nome = input.nome?.trim();
  const telefone = input.telefone?.trim();

  if (!nome) return { success: false, error: "Nome é obrigatório." };
  if (!telefone) return { success: false, error: "Telefone é obrigatório." };

  const digitos = normalizarTelefone(telefone);

  // Evita duplicar quem já existe — devolve o existente para a UI o poder abrir.
  const { data: existente } = await supabaseAdmin
    .from("motorista")
    .select("id")
    .eq("telefone_digitos", digitos)
    .maybeSingle();

  if (existente) {
    return {
      success: false,
      error: "Já existe um motorista com este telefone.",
      jaExistiaId: existente.id,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("motorista")
    .insert({
      nome,
      telefone,
      telefone_digitos: digitos,
      email: input.email?.trim() || null,
      plataforma: input.plataforma?.trim() || null,
      notas: input.notas?.trim() || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("criarMotorista error:", error);
    return { success: false, error: "Erro ao criar motorista." };
  }

  revalidatePath("/admin/motoristas");
  return { success: true, id: data.id };
}

export async function atualizarMotorista(
  id: string,
  updates: Partial<Pick<Motorista, "nome" | "telefone" | "email" | "plataforma" | "notas">>,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const dados: Partial<Motorista> = { ...updates };
  if (typeof updates.telefone === "string") {
    dados.telefone_digitos = normalizarTelefone(updates.telefone);
  }

  const { error } = await supabaseAdmin.from("motorista").update(dados).eq("id", id);

  if (error) {
    console.error("atualizarMotorista error:", error);
    return { success: false, error: "Erro ao atualizar motorista." };
  }

  revalidatePath("/admin/motoristas");
  return { success: true };
}

export async function eliminarMotorista(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  // As avaliações caem com o motorista (on delete cascade).
  const { error } = await supabaseAdmin.from("motorista").delete().eq("id", id);

  if (error) {
    console.error("eliminarMotorista error:", error);
    return { success: false, error: "Erro ao eliminar motorista." };
  }

  revalidatePath("/admin/motoristas");
  return { success: true };
}

export interface CriarAvaliacaoInput {
  motoristaId: string;
  tipo: AvaliacaoTipo;
  nota?: number | null;
  comentario?: string;
  dataAluguer?: string;
}

export async function criarAvaliacao(
  input: CriarAvaliacaoInput,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!["positiva", "negativa", "neutra"].includes(input.tipo)) {
    return { success: false, error: "Tipo de avaliação inválido." };
  }

  const { error } = await supabaseAdmin.from("avaliacao").insert({
    motorista_id: input.motoristaId,
    tipo: input.tipo,
    nota: input.nota ?? null,
    comentario: input.comentario?.trim() || null,
    data_aluguer: input.dataAluguer || null,
  });

  if (error) {
    console.error("criarAvaliacao error:", error);
    return { success: false, error: "Erro ao gravar avaliação." };
  }

  revalidatePath("/admin/motoristas");
  return { success: true };
}

export async function eliminarAvaliacao(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin.from("avaliacao").delete().eq("id", id);

  if (error) {
    console.error("eliminarAvaliacao error:", error);
    return { success: false, error: "Erro ao eliminar avaliação." };
  }

  revalidatePath("/admin/motoristas");
  return { success: true };
}

export type { Avaliacao };
