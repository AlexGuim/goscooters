import { supabaseBrowser } from "@/lib/supabaseClient";
import { criarUploadAssinado } from "@/actions/fotoActions";

const BUCKET = "motas";

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

export const DOC_TAMANHO_MAXIMO = 15 * 1024 * 1024; // 15 MB
export const DOC_TIPOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

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
