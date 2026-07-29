"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import type { RegrasAluguer } from "@/types/db";

export type RegrasAtivas = Pick<RegrasAluguer, "versao" | "conteudo" | "hash" | "created_at">;

const norm = (idioma: string | null | undefined): "pt" | "en" =>
  (idioma ?? "pt").slice(0, 2).toLowerCase() === "en" ? "en" : "pt";

/**
 * A versão ativa das regras NA LÍNGUA pedida (default pt). Se essa língua ainda
 * não tiver versão, recua para PT. Null se nada existir (ou SQL por migrar).
 */
export async function regrasAtivas(idioma: string = "pt"): Promise<RegrasAtivas | null> {
  const lang = norm(idioma);
  const { data, error } = await supabaseAdmin
    .from("regras_aluguer")
    .select("versao, conteudo, hash, created_at")
    .eq("ativa", true)
    .eq("idioma", lang)
    .maybeSingle();
  if (error) return null; // tabela/coluna ainda não migrada — não parte
  if (data) return data;
  if (lang !== "pt") {
    const { data: pt } = await supabaseAdmin
      .from("regras_aluguer")
      .select("versao, conteudo, hash, created_at")
      .eq("ativa", true)
      .eq("idioma", "pt")
      .maybeSingle();
    return pt ?? null;
  }
  return null;
}

/** Grava uma NOVA versão (com hash) para uma LÍNGUA e marca-a como ativa nessa língua. */
export async function guardarRegras(
  conteudo: string,
  idioma: string = "pt",
): Promise<{ success: boolean; versao?: string; hash?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const lang = norm(idioma);
  const texto = conteudo.trim();
  if (texto.length < 20) return { success: false, error: "O texto é demasiado curto." };

  const hash = createHash("sha256").update(texto, "utf8").digest("hex");
  const versao = new Date().toISOString().slice(0, 10);

  // Desativa a atual DESSA LÍNGUA e insere a nova (o índice único garante 1 ativa por língua).
  await supabaseAdmin.from("regras_aluguer").update({ ativa: false }).eq("ativa", true).eq("idioma", lang);
  const { error } = await supabaseAdmin.from("regras_aluguer").insert({
    versao,
    idioma: lang,
    conteudo: texto,
    hash,
    ativa: true,
    criado_por: auth.user.email ?? null,
  });
  if (error) {
    console.error("guardarRegras error:", error);
    return { success: false, error: "Erro ao guardar (confirma que correste sql/fase9_regras_idioma.sql)." };
  }

  revalidatePath("/admin/regras");
  return { success: true, versao, hash };
}
