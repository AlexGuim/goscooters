import { supabaseBrowser } from "@/lib/supabaseClient";
import { criarUploadAssinado, criarUploadPrivado } from "@/actions/fotoActions";
import { criarUploadPorToken } from "@/actions/entregaActions";

const BUCKET = "motas";
const BUCKET_PRIVADO = "privado";

export const FOTO_TAMANHO_MAXIMO = 10 * 1024 * 1024; // 10 MB
export const FOTO_TIPOS = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export const VIDEO_TAMANHO_MAXIMO = 50 * 1024 * 1024; // 50 MB
// mp4/webm/quicktime cobrem o que os telemóveis gravam (o .mov do iPhone é
// video/quicktime).
export const VIDEO_TIPOS = ["video/mp4", "video/webm", "video/quicktime"];

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(bytes > 5 * 1024 * 1024 ? 0 : 1);
}

/**
 * Envia um ficheiro directamente para o Supabase Storage.
 *
 * O servidor só assina a autorização (payload minúsculo); o ficheiro em si vai
 * do browser directo para o Supabase, sem atravessar a Vercel — por isso não há
 * o limite de 1 MB das Server Actions.
 */
async function enviarFicheiro(
  ficheiro: File,
  pasta: "" | "videos" | "faturas",
): Promise<{ success: boolean; url?: string; path?: string; error?: string }> {
  const prep = await criarUploadAssinado(ficheiro.name, pasta);

  if (!prep.success || !prep.dados) {
    return { success: false, error: prep.error ?? "Erro ao preparar o upload." };
  }

  const { error } = await supabaseBrowser.storage
    .from(BUCKET)
    .uploadToSignedUrl(prep.dados.path, prep.dados.token, ficheiro);

  if (error) {
    console.error("uploadToSignedUrl error:", error);
    return { success: false, error: "Erro ao carregar o ficheiro. Tenta de novo." };
  }

  return { success: true, url: prep.dados.url, path: prep.dados.path };
}

export async function enviarFoto(
  ficheiro: File,
): Promise<{ success: boolean; url?: string; error?: string }> {
  if (!FOTO_TIPOS.includes(ficheiro.type)) {
    return { success: false, error: "Formato não suportado. Usa JPG, PNG, WebP ou AVIF." };
  }
  if (ficheiro.size > FOTO_TAMANHO_MAXIMO) {
    return { success: false, error: `A imagem tem ${mb(ficheiro.size)} MB. O máximo é 10 MB.` };
  }
  return enviarFicheiro(ficheiro, "");
}

export async function enviarVideo(
  ficheiro: File,
): Promise<{ success: boolean; url?: string; error?: string }> {
  if (!VIDEO_TIPOS.includes(ficheiro.type)) {
    return { success: false, error: "Formato não suportado. Usa MP4, WebM ou MOV." };
  }
  if (ficheiro.size > VIDEO_TAMANHO_MAXIMO) {
    return {
      success: false,
      error: `O vídeo tem ${mb(ficheiro.size)} MB. O máximo é 50 MB — grava um clip mais curto.`,
    };
  }
  return enviarFicheiro(ficheiro, "videos");
}

// ── Bucket PRIVADO (documentos, vídeos e assinaturas sensíveis) ─────────────
// Devolve o CAMINHO (a guardar na BD), nunca um URL público. Lê-se por URL
// assinado (urlAssinado).
async function enviarPrivado(
  ficheiro: Blob,
  nome: string,
  pasta: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const prep = await criarUploadPrivado(nome, pasta);
  if (!prep.success || !prep.dados) {
    return { success: false, error: prep.error ?? "Erro ao preparar o upload." };
  }
  const { error } = await supabaseBrowser.storage
    .from(BUCKET_PRIVADO)
    .uploadToSignedUrl(prep.dados.path, prep.dados.token, ficheiro);
  if (error) {
    console.error("uploadToSignedUrl (privado) error:", error);
    return { success: false, error: "Erro ao carregar o ficheiro. Tenta de novo." };
  }
  return { success: true, path: prep.dados.path };
}

export async function enviarFotoPrivada(
  ficheiro: File,
): Promise<{ success: boolean; path?: string; error?: string }> {
  if (!FOTO_TIPOS.includes(ficheiro.type)) {
    return { success: false, error: "Formato não suportado. Usa JPG, PNG ou WebP." };
  }
  if (ficheiro.size > FOTO_TAMANHO_MAXIMO) {
    return { success: false, error: `A imagem tem ${mb(ficheiro.size)} MB. O máximo é 10 MB.` };
  }
  return enviarPrivado(ficheiro, ficheiro.name, "vistorias/fotos");
}

export async function enviarVideoPrivado(
  ficheiro: File,
): Promise<{ success: boolean; path?: string; error?: string }> {
  if (!VIDEO_TIPOS.includes(ficheiro.type)) {
    return { success: false, error: "Formato não suportado. Usa MP4, WebM ou MOV." };
  }
  if (ficheiro.size > VIDEO_TAMANHO_MAXIMO) {
    return { success: false, error: `O vídeo tem ${mb(ficheiro.size)} MB. O máximo é 50 MB.` };
  }
  return enviarPrivado(ficheiro, ficheiro.name, "vistorias/videos");
}

/** Assinatura desenhada no ecrã (PNG). */
export async function enviarAssinaturaPrivada(
  blob: Blob,
): Promise<{ success: boolean; path?: string; error?: string }> {
  return enviarPrivado(blob, "assinatura.png", "vistorias/assinaturas");
}

export const DOC_TAMANHO_MAXIMO = 15 * 1024 * 1024; // 15 MB
export const DOC_TIPOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

// ── Upload autorizado por TOKEN de entrega (motorista, sem conta) ────────────
async function enviarPorToken(
  token: string,
  ficheiro: Blob,
  nome: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const prep = await criarUploadPorToken(token, nome);
  if (!prep.ok || !prep.path || !prep.uploadToken) {
    return { success: false, error: prep.error ?? "Erro ao preparar o upload." };
  }
  const { error } = await supabaseBrowser.storage
    .from(BUCKET_PRIVADO)
    .uploadToSignedUrl(prep.path, prep.uploadToken, ficheiro);
  if (error) {
    console.error("uploadToSignedUrl (token) error:", error);
    return { success: false, error: "Erro ao carregar. Tenta de novo." };
  }
  return { success: true, path: prep.path };
}

export async function enviarDocPorToken(
  token: string,
  ficheiro: File,
): Promise<{ success: boolean; path?: string; error?: string }> {
  if (!DOC_TIPOS.includes(ficheiro.type)) {
    return { success: false, error: "Formato não suportado. Usa foto (JPG/PNG) ou PDF." };
  }
  if (ficheiro.size > DOC_TAMANHO_MAXIMO) {
    return { success: false, error: `O ficheiro tem ${mb(ficheiro.size)} MB. O máximo é 15 MB.` };
  }
  return enviarPorToken(token, ficheiro, ficheiro.name);
}

export async function enviarAssinaturaPorToken(
  token: string,
  blob: Blob,
): Promise<{ success: boolean; path?: string; error?: string }> {
  return enviarPorToken(token, blob, "assinatura.png");
}

/** Envia uma fatura/documento (PDF ou imagem) e devolve o URL e o caminho. */
export async function enviarDocumento(
  ficheiro: File,
): Promise<{ success: boolean; url?: string; path?: string; error?: string }> {
  if (!DOC_TIPOS.includes(ficheiro.type)) {
    return { success: false, error: "Formato não suportado. Usa PDF, JPG, PNG ou WebP." };
  }
  if (ficheiro.size > DOC_TAMANHO_MAXIMO) {
    return { success: false, error: `O ficheiro tem ${mb(ficheiro.size)} MB. O máximo é 15 MB.` };
  }
  return enviarFicheiro(ficheiro, "faturas");
}
