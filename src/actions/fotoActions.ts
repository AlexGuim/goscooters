"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";

const BUCKET = "motas";

/**
 * Os ficheiros NÃO passam por aqui.
 *
 * As Server Actions têm um limite de ~1 MB no corpo do pedido (e a Vercel um
 * teto próprio), portanto enviar fotos ou vídeos através do servidor não
 * escala. Em vez disso, o servidor apenas assina uma autorização de upload
 * (uns bytes) e o browser envia o ficheiro directamente para o Supabase.
 *
 * A validação de tipo e tamanho vive no cliente (MotoForm), já que o servidor
 * nunca vê o ficheiro. Como a autorização é de uso único, de curta duração e só
 * um admin autenticado a obtém, o caminho continua controlado.
 */

/** Nome seguro para uma chave de storage: sem acentos, espaços ou escapes. */
function nomeSeguro(nome: string): string {
  const extensao = nome.split(".").pop()?.toLowerCase() ?? "bin";
  const base = nome
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .toLowerCase();

  return `${base || "ficheiro"}.${extensao}`;
}

export interface UploadAssinado {
  /** Caminho no bucket, para o browser fazer uploadToSignedUrl. */
  path: string;
  /** Token da autorização de upload. */
  token: string;
  /** URL público final, para guardar na base de dados depois do upload. */
  url: string;
}

/**
 * Prepara um upload directo: devolve o caminho, o token e o URL público final.
 * `pasta` separa os vídeos das fotos dentro do mesmo bucket.
 */
export async function criarUploadAssinado(
  nomeFicheiro: string,
  pasta: "" | "videos" | "faturas" = "",
): Promise<{ success: boolean; dados?: UploadAssinado; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const prefixo = pasta ? `${pasta}/` : "";
  const caminho = `${prefixo}${crypto.randomUUID()}-${nomeSeguro(nomeFicheiro)}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(caminho);

  if (error || !data) {
    console.error("createSignedUploadUrl error:", error);
    return { success: false, error: "Erro ao preparar o upload." };
  }

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(data.path);

  return {
    success: true,
    dados: { path: data.path, token: data.token, url: publicUrl },
  };
}

const BUCKET_PRIVADO = "privado";

/**
 * Prepara um upload direto para o bucket PRIVADO (documentos, vídeos e
 * assinaturas sensíveis). Devolve o CAMINHO (a guardar na BD) e o token — nunca
 * um URL público, porque estes ficheiros só se leem por URL assinado.
 */
export async function criarUploadPrivado(
  nomeFicheiro: string,
  pasta: string,
): Promise<{ success: boolean; dados?: { path: string; token: string }; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const prefixo = pasta ? `${pasta.replace(/[^a-z0-9/_-]/gi, "")}/` : "";
  const caminho = `${prefixo}${crypto.randomUUID()}-${nomeSeguro(nomeFicheiro)}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_PRIVADO)
    .createSignedUploadUrl(caminho);

  if (error || !data) {
    console.error("criarUploadPrivado error:", error);
    return { success: false, error: "Erro ao preparar o upload." };
  }
  return { success: true, dados: { path: data.path, token: data.token } };
}

/**
 * Devolve um URL assinado, de curta duração, para LER um ficheiro privado.
 * Só um admin autenticado o obtém — é assim que se mostram documentos/vídeos
 * sensíveis sem os pôr num bucket público.
 */
export async function urlAssinado(
  path: string,
  segundos = 3600,
): Promise<{ success: boolean; url?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!path) return { success: false, error: "Caminho em falta." };

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_PRIVADO)
    .createSignedUrl(path, segundos);
  if (error || !data) {
    console.error("urlAssinado error:", error);
    return { success: false, error: "Não consegui abrir o ficheiro." };
  }
  return { success: true, url: data.signedUrl };
}

/**
 * Remove um ficheiro do storage. Só actua sobre ficheiros do nosso bucket —
 * URLs externos (as fotos antigas do Unsplash, por exemplo) são ignorados em
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
    return { success: false, error: "Erro ao remover o ficheiro." };
  }

  return { success: true };
}
