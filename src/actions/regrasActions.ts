"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import type { RegrasAluguer } from "@/types/db";

export type RegrasAtivas = Pick<RegrasAluguer, "versao" | "conteudo" | "hash" | "created_at">;

/** A versão ativa das regras, ou null (também null se a SQL ainda não correu). */
export async function regrasAtivas(): Promise<RegrasAtivas | null> {
  const { data, error } = await supabaseAdmin
    .from("regras_aluguer")
    .select("versao, conteudo, hash, created_at")
    .eq("ativa", true)
    .maybeSingle();
  if (error) return null; // tabela ainda não migrada — não parte
  return data ?? null;
}

/** Grava uma NOVA versão (com hash) e marca-a como ativa. */
export async function guardarRegras(
  conteudo: string,
): Promise<{ success: boolean; versao?: string; hash?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const texto = conteudo.trim();
  if (texto.length < 20) return { success: false, error: "O texto é demasiado curto." };

  const hash = createHash("sha256").update(texto, "utf8").digest("hex");
  const versao = new Date().toISOString().slice(0, 10);

  // Desativa a atual e insere a nova como ativa (o índice único garante 1 ativa).
  await supabaseAdmin.from("regras_aluguer").update({ ativa: false }).eq("ativa", true);
  const { error } = await supabaseAdmin.from("regras_aluguer").insert({
    versao,
    conteudo: texto,
    hash,
    ativa: true,
    criado_por: auth.user.email ?? null,
  });
  if (error) {
    console.error("guardarRegras error:", error);
    return { success: false, error: "Erro ao guardar (confirma que correste sql/fase4_regras.sql)." };
  }

  revalidatePath("/admin/regras");
  return { success: true, versao, hash };
}
