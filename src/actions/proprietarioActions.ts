"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
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

/**
 * Convida um parceiro para o portal: cria (ou reutiliza) o utilizador Supabase
 * Auth por email, liga-o ao proprietário (auth_user_id) e ativa o portal. O
 * parceiro recebe um email com um link que o autentica e o leva a /portal.
 */
async function encontrarUtilizador(mail: string): Promise<string | null> {
  const { data } = await supabaseAdmin.auth.admin.listUsers();
  return data?.users.find((u) => u.email?.toLowerCase() === mail)?.id ?? null;
}

export async function convidarParceiro(
  proprietarioId: string,
  email: string,
  password?: string,
): Promise<{ success: boolean; error?: string; via?: "password" | "email" }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const mail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
    return { success: false, error: "Indica um email válido." };
  }
  const pw = password?.trim() || "";
  if (pw && pw.length < 6) {
    return { success: false, error: "A palavra-passe tem de ter pelo menos 6 caracteres." };
  }

  let userId: string | null = null;
  const via: "password" | "email" = pw ? "password" : "email";

  if (pw) {
    // Com palavra-passe: cria (ou define no existente) SEM enviar email — imune
    // ao rate limit do email e permite entrar logo com email + palavra-passe.
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: mail,
      password: pw,
      email_confirm: true,
    });
    if (error) {
      if (!/already|exist|registered/i.test(error.message)) {
        console.error("convidarParceiro createUser error:", error);
        return { success: false, error: "Não foi possível criar o acesso." };
      }
      userId = await encontrarUtilizador(mail);
      if (userId) await supabaseAdmin.auth.admin.updateUserById(userId, { password: pw });
    } else {
      userId = data.user?.id ?? null;
    }
  } else {
    // Sem palavra-passe: convite por email (link de acesso).
    const h = await headers();
    const origin = h.get("origin") ?? `https://${h.get("host") ?? "goscooters.vercel.app"}`;
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(mail, {
      redirectTo: `${origin}/auth/callback?next=/portal`,
    });
    if (error) {
      if (!/already|exist|registered/i.test(error.message)) {
        console.error("convidarParceiro invite error:", error);
        return { success: false, error: "Não foi possível enviar o convite (verifica o SMTP no Supabase)." };
      }
      userId = await encontrarUtilizador(mail);
    } else {
      userId = data.user?.id ?? null;
    }
  }

  if (!userId) return { success: false, error: "Não consegui obter o utilizador do parceiro." };

  const { error: upErr } = await supabaseAdmin
    .from("proprietario")
    .update({ auth_user_id: userId, portal_ativo: true, email: mail })
    .eq("id", proprietarioId);
  if (upErr) {
    console.error("convidarParceiro link error:", upErr);
    return { success: false, error: "Este utilizador já está ligado a outro proprietário." };
  }

  revalidatePath("/admin/proprietarios");
  return { success: true, via };
}

/** Revoga o acesso do parceiro ao portal (mantém o vínculo Auth). */
export async function revogarPortal(
  proprietarioId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin
    .from("proprietario")
    .update({ portal_ativo: false })
    .eq("id", proprietarioId);
  if (error) return { success: false, error: "Erro ao revogar o acesso." };

  revalidatePath("/admin/proprietarios");
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
