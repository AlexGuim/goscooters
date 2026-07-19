"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";

const BUCKET = "motas";
const TAMANHO_MAXIMO = 5 * 1024 * 1024; // 5 MB
const TIPOS_ACEITES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/**
 * Transforma o nome do ficheiro em algo seguro para uma chave de storage:
 * sem acentos, sem espaços, sem caracteres que precisem de escape.
 */
function nomeSeguro(nome: string): string {
  const extensao = nome.split(".").pop()?.toLowerCase() ?? "jpg";
  const base = nome
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .toLowerCase();

  return `${base || "foto"}.${extensao}`;
}

export async function uploadFotoMoto(
  formData: FormData,
): Promise<{ success: boolean; url?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const ficheiro = formData.get("foto");

  if (!(ficheiro instanceof File) || ficheiro.size === 0) {
    return { success: false, error: "Nenhum ficheiro recebido." };
  }

  if (!TIPOS_ACEITES.includes(ficheiro.type)) {
    return {
      success: false,
      error: "Formato não suportado. Usa JPG, PNG, WebP ou AVIF.",
    };
  }

  if (ficheiro.size > TAMANHO_MAXIMO) {
    const mb = (ficheiro.size / 1024 / 1024).toFixed(1);
    return { success: false, error: `A imagem tem ${mb} MB. O máximo é 5 MB.` };
  }

  // Prefixo aleatório para duas fotos com o mesmo nome não se sobreporem.
  const caminho = `${crypto.randomUUID()}-${nomeSeguro(ficheiro.name)}`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(caminho, ficheiro, {
      contentType: ficheiro.type,
      upsert: false,
    });

  if (error) {
    console.error("Storage upload error:", error);
    return { success: false, error: "Erro ao carregar a imagem." };
  }

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(caminho);

  return { success: true, url: publicUrl };
}

/**
 * Remove a imagem do storage. Só actua sobre ficheiros do nosso bucket — URLs
 * externos (as fotos antigas do Unsplash, por exemplo) são ignorados em
 * silêncio, já que não há nada nosso para apagar.
 */
export async function deleteFotoMoto(
  url: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const marcador = `/storage/v1/object/public/${BUCKET}/`;
  const indice = url.indexOf(marcador);

  if (indice === -1) {
    return { success: true };
  }

  const caminho = decodeURIComponent(url.slice(indice + marcador.length));
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([caminho]);

  if (error) {
    console.error("Storage delete error:", error);
    return { success: false, error: "Erro ao remover a imagem." };
  }

  return { success: true };
}
