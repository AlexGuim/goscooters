"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { geminiConfigurado, lerDocumentoGemini, mimeDoCaminho, type CamposDocumento } from "@/lib/gemini";

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
/**
 * Lê documentos já carregados no bucket privado com o Gemini e devolve os campos
 * para pré-preencher (versão admin do lerDocumentoIAporToken do fluxo público).
 * Sem GEMINI_API_KEY devolve semIA=true (o cliente recorre ao OCR do browser).
 */
export async function lerDocumentoIA(
  paths: string[],
  /**
   * De que bucket ler. O intake de Documentos classifica o ficheiro a partir do
   * bucket público (é lá que as faturas têm de ficar, para o extrato do parceiro
   * as poder abrir); quando o documento afinal é de identidade, é preciso poder
   * lê-lo de lá — e apagá-lo a seguir, que é o que o chamador faz.
   */
  bucket: "privado" | "motas" = "privado",
): Promise<{ ok: boolean; dados?: CamposDocumento; error?: string; semIA?: boolean }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!geminiConfigurado()) return { ok: false, semIA: true };

  const imagens: { mime: string; base64: string }[] = [];
  // Até 6: frente e verso da carta, o título de residência e um comprovativo de
  // morada já são 4 — o limite existe só para travar um lote absurdo.
  for (const p of (paths ?? []).slice(0, 6)) {
    if (!p) continue;
    const { data, error } = await supabaseAdmin.storage.from(bucket === "motas" ? BUCKET : BUCKET_PRIVADO).download(p);
    if (error || !data) continue;
    const mime = mimeDoCaminho(p);
    if (!mime.startsWith("image/") && mime !== "application/pdf") continue;
    const buf = Buffer.from(await data.arrayBuffer());
    imagens.push({ mime, base64: buf.toString("base64") });
  }
  if (!imagens.length) return { ok: false, error: "Sem imagens para ler." };
  const dados = await lerDocumentoGemini(imagens);
  if (!dados) return { ok: false, error: "Não consegui ler o documento." };
  return { ok: true, dados };
}

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


/**
 * Apaga um ficheiro do bucket PÚBLICO.
 *
 * Serve o caso do documento de identidade que entrou pela aba Documentos: o
 * intake grava no bucket público para poder classificar, mas um documento de
 * identidade não pode ficar acessível por URL. Lidos os campos para a ficha, o
 * ficheiro deixa de ter razão de existir — e apaga-se.
 */
export async function apagarDocumentoPublico(path: string): Promise<{ ok: boolean }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false };
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error) console.error("apagarDocumentoPublico error:", error);
  return { ok: !error };
}

/**
 * Move um documento do bucket PÚBLICO para o PRIVADO, no servidor.
 *
 * O intake classifica a partir do bucket público (é onde as faturas têm de
 * ficar). Quando o que lá entrou é um documento de identidade, a cópia tem de
 * sair de lá — mas o FICHEIRO faz falta na ficha (`doc_urls`): sem ele a
 * entrega volta a pedir o mesmo cartão que o gestor acabou de fotografar.
 * Copiar de servidor para servidor evita o segundo upload a partir do
 * telemóvel; o público apaga-se em qualquer caso.
 */
export async function moverDocumentoParaPrivado(
  path: string,
): Promise<{ ok: boolean; path?: string; publicoFicou?: boolean }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false };
  const { data: blob, error: erroLer } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (erroLer || !blob) {
    console.error("moverDocumentoParaPrivado download:", erroLer);
    // Mesmo sem conseguir ler, tenta tirá-lo de lá: um documento de identidade
    // não fica acessível por URL por causa de uma falha de leitura.
    return { ok: false, publicoFicou: !(await removerDoPublico(path)) };
  }
  const nome = path.split("/").pop() ?? path;
  const destino = `kyc/${crypto.randomUUID()}-${nomeSeguro(nome)}`;
  const { error: erroGravar } = await supabaseAdmin.storage
    .from(BUCKET_PRIVADO)
    .upload(destino, blob, { contentType: mimeDoCaminho(path), upsert: false });
  // O público sai SEMPRE — mesmo que a cópia falhe. E diz-se se NÃO saiu:
  // um "ok" com o cartão ainda acessível por URL era o pior dos silêncios.
  const publicoFicou = !(await removerDoPublico(path));
  if (erroGravar) {
    console.error("moverDocumentoParaPrivado upload:", erroGravar);
    return { ok: false, publicoFicou };
  }
  return { ok: true, path: destino, publicoFicou };
}

/** Remove do bucket público, com uma segunda tentativa. True se saiu. */
async function removerDoPublico(path: string): Promise<boolean> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
    if (!error) return true;
    console.error(`moverDocumentoParaPrivado remove (tentativa ${tentativa + 1}):`, error);
  }
  return false;
}

/**
 * Apaga ficheiros do bucket PRIVADO que ficaram sem dono — os documentos lidos
 * de um lote que o gestor cancelou antes de os aplicar a uma ficha. Só toca em
 * `kyc/…`: é o único prefixo que este fluxo cria.
 */
export async function apagarDocumentosPrivados(paths: string[]): Promise<{ ok: boolean }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false };
  const alvo = paths.filter((p) => p.startsWith("kyc/") && !p.includes(".."));
  if (!alvo.length) return { ok: true };
  const { error } = await supabaseAdmin.storage.from(BUCKET_PRIVADO).remove(alvo);
  if (error) console.error("apagarDocumentosPrivados error:", error);
  return { ok: !error };
}
