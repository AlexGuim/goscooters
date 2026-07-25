"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { mensagemLinkEntrega, mensagemLinkRegisto } from "@/lib/mensagens";
import { normalizarTelefone, paraE164 } from "@/lib/telefone";
import { notificar } from "@/lib/notificacoes";
import { geminiConfigurado, lerDocumentoGemini, mimeDoCaminho, type CamposDocumento } from "@/lib/gemini";
import type { Database, DocIdTipo, EntregaSessao } from "@/types/db";

type MotoristaUpdate = Database["public"]["Tables"]["motorista"]["Update"];

const BUCKET_PRIVADO = "privado";
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Valida um token de sessão de entrega: existe, não expirou e ainda está aberta.
 * Devolve a sessão ou null. O token vem em claro no URL; guardamos só o hash.
 */
async function sessaoValida(token: string): Promise<EntregaSessao | null> {
  if (!token || token.length < 16) return null;
  const { data } = await supabaseAdmin
    .from("entrega_sessao")
    .select("*")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expira_em).getTime() < Date.now()) return null;
  if (["concluido", "cancelado", "expirado"].includes(data.estado)) return null;
  return data;
}

// ── Admin ───────────────────────────────────────────────────────────────────

/** Cria uma sessão de entrega para um contrato e devolve o LINK (uma só vez). */
export async function criarSessaoEntrega(
  contratoId: string,
): Promise<{ success: boolean; link?: string; whatsapp?: string | null; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id, motorista_id")
    .eq("id", contratoId)
    .maybeSingle();
  if (!c) return { success: false, error: "Contrato não encontrado." };

  const token = randomBytes(24).toString("base64url");
  const expira = new Date(Date.now() + 72 * 3600 * 1000).toISOString();

  const { error } = await supabaseAdmin.from("entrega_sessao").insert({
    token_hash: hashToken(token),
    contrato_id: contratoId,
    motorista_id: c.motorista_id,
    estado: "enviado",
    expira_em: expira,
  });
  if (error) {
    console.error("criarSessaoEntrega error:", error);
    return { success: false, error: "Erro ao criar a sessão (corre sql/fase4b_entrega_sessao)." };
  }

  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host") ?? "goscooters.vercel.app"}`;
  const link = `${origin}/entrega/${token}`;

  // Mensagem pronta no WhatsApp, na língua do motorista (click-to-send).
  let whatsapp: string | null = null;
  if (c.motorista_id) {
    const { data: m } = await supabaseAdmin
      .from("motorista")
      .select("nome, telefone_e164, idioma_preferido")
      .eq("id", c.motorista_id)
      .maybeSingle();
    if (m?.telefone_e164) {
      const num = m.telefone_e164.replace(/\D/g, "");
      const texto = mensagemLinkEntrega(m.nome ?? "", link, m.idioma_preferido);
      whatsapp = `https://wa.me/${num}?text=${encodeURIComponent(texto)}`;
    }
  }

  revalidatePath("/admin/contratos");
  return { success: true, link, whatsapp };
}

/**
 * Cria uma sessão de REGISTO (sem contrato): o motorista regista-se por link
 * antes de existir contrato — carrega o documento, o OCR pré-preenche e ele
 * confirma. Reutiliza o motorista existente pelo telefone, ou cria um lead.
 * As regras/assinatura ficam para a entrega (quando houver contrato e mota).
 */
export async function criarSessaoRegisto(input: {
  nome?: string | null;
  telefone: string;
  idioma?: string | null;
}): Promise<{ success: boolean; link?: string; whatsapp?: string | null; error?: string; motorista_id?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const telefone = input.telefone?.trim();
  if (!telefone) return { success: false, error: "Indica o telefone do motorista." };
  const digitos = normalizarTelefone(telefone);
  // A escolha do idioma determina a língua da mensagem E do formulário (pt|en).
  const idioma = (input.idioma || "pt").slice(0, 2).toLowerCase() === "pt" ? "pt" : "en";

  // Reutiliza o motorista pelo telefone, ou cria um lead mínimo.
  let motoristaId: string;
  const { data: existente } = await supabaseAdmin
    .from("motorista")
    .select("id")
    .eq("telefone_digitos", digitos)
    .maybeSingle();
  if (existente) {
    motoristaId = existente.id;
    // A escolha do admin manda: atualiza a língua no registo existente.
    await supabaseAdmin.from("motorista").update({ idioma_preferido: idioma }).eq("id", motoristaId);
  } else {
    const { data: novo, error: eNovo } = await supabaseAdmin
      .from("motorista")
      .insert({
        nome: input.nome?.trim() || "Motorista (por confirmar)",
        telefone,
        telefone_digitos: digitos,
        telefone_e164: paraE164(telefone),
        idioma_preferido: idioma,
        estado: "lead",
      })
      .select("id")
      .single();
    if (novo) {
      motoristaId = novo.id;
    } else if (eNovo?.code === "23505") {
      // Corrida no telefone único — reutiliza o registo criado entretanto.
      const { data: re } = await supabaseAdmin
        .from("motorista")
        .select("id")
        .eq("telefone_digitos", digitos)
        .maybeSingle();
      if (!re) return { success: false, error: "Erro ao criar o motorista." };
      motoristaId = re.id;
      await supabaseAdmin.from("motorista").update({ idioma_preferido: idioma }).eq("id", motoristaId);
    } else {
      console.error("criarSessaoRegisto motorista error:", eNovo);
      return { success: false, error: "Erro ao criar o motorista." };
    }
  }

  // Abre a jornada: um pré-contrato à espera de mota (se ainda não houver um).
  const { data: preJa } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id")
    .eq("motorista_id", motoristaId)
    .eq("estado", "pre_contrato")
    .maybeSingle();
  if (!preJa) {
    const { data: pc } = await supabaseAdmin
      .from("contrato_aluguer")
      .insert({ motorista_id: motoristaId, estado: "pre_contrato" })
      .select("id, numero")
      .maybeSingle();
    if (pc) {
      await notificar({
        tipo: "pre_contrato_sem_mota",
        titulo: "Pré-contrato à espera de mota",
        detalhe: `Registo por link aberto (${pc.numero}) — atribuir mota, preço e data.`,
        href: "/admin/contratos",
        entidade: "contrato",
        entidade_id: pc.id,
      });
    }
  }

  const token = randomBytes(24).toString("base64url");
  const expira = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const { error } = await supabaseAdmin.from("entrega_sessao").insert({
    token_hash: hashToken(token),
    contrato_id: null,
    motorista_id: motoristaId,
    estado: "enviado",
    expira_em: expira,
  });
  if (error) {
    console.error("criarSessaoRegisto sessao error:", error);
    return { success: false, error: "Erro ao criar a sessão (corre sql/fase4b_entrega_sessao)." };
  }

  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host") ?? "goscooters.vercel.app"}`;
  const link = `${origin}/entrega/${token}`;

  let whatsapp: string | null = null;
  const { data: m } = await supabaseAdmin
    .from("motorista")
    .select("nome, telefone_e164, idioma_preferido")
    .eq("id", motoristaId)
    .maybeSingle();
  if (m?.telefone_e164) {
    const num = m.telefone_e164.replace(/\D/g, "");
    const texto = mensagemLinkRegisto(m.nome ?? "", link, m.idioma_preferido);
    whatsapp = `https://wa.me/${num}?text=${encodeURIComponent(texto)}`;
  }

  revalidatePath("/admin/motoristas");
  return { success: true, link, whatsapp, motorista_id: motoristaId };
}

// ── Público (validado por token, sem conta) ──────────────────────────────────

export interface SessaoPublica {
  motorista_nome: string;
  veiculo: string;
  consentiu: boolean;
  regras: { versao: string; hash: string; conteudo: string } | null;
  // true = registo sem contrato (só recolha de dados; regras/assinatura ficam
  // para a entrega). false = preparação de uma entrega concreta.
  registo: boolean;
  // Língua do formulário: 'pt' para motoristas de língua portuguesa, 'en' para
  // os restantes (política do negócio).
  idioma: "pt" | "en";
}

/** Dados para a página pública. Marca a sessão como 'aberta' na 1.ª visita. */
export async function sessaoPorToken(
  token: string,
): Promise<{ ok: boolean; sessao?: SessaoPublica; error?: string }> {
  const s = await sessaoValida(token);
  if (!s) return { ok: false, error: "Link inválido ou expirado. Pede um novo à GoScooters." };

  if (s.estado === "enviado") {
    await supabaseAdmin.from("entrega_sessao").update({ estado: "aberto" }).eq("id", s.id);
  }

  const [{ data: mot }, { data: c }] = await Promise.all([
    s.motorista_id
      ? supabaseAdmin.from("motorista").select("nome, idioma_preferido").eq("id", s.motorista_id).maybeSingle()
      : Promise.resolve({ data: null }),
    s.contrato_id
      ? supabaseAdmin.from("contrato_aluguer").select("veiculo_id").eq("id", s.contrato_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const registo = !s.contrato_id;
  let veiculo = "a tua mota";
  if (c?.veiculo_id) {
    const { data: m } = await supabaseAdmin.from("moto").select("matricula, modelo").eq("id", c.veiculo_id).maybeSingle();
    if (m) veiculo = `${m.matricula ?? ""} ${m.modelo}`.trim();
  }
  // No registo (sem contrato) as regras do aluguer não se aplicam ainda — só se
  // aceitam na entrega, para a mota concreta.
  const { data: regras } = registo
    ? { data: null }
    : await supabaseAdmin
        .from("regras_aluguer")
        .select("versao, hash, conteudo")
        .eq("ativa", true)
        .maybeSingle();

  const idiomaMot = (mot as { idioma_preferido?: string | null } | null)?.idioma_preferido;
  const idioma: "pt" | "en" = (idiomaMot || "pt").slice(0, 2).toLowerCase() === "pt" ? "pt" : "en";

  return {
    ok: true,
    sessao: {
      motorista_nome: mot?.nome ?? "",
      veiculo,
      consentiu: !!s.consentimento_em,
      regras: regras ?? null,
      registo,
      idioma,
    },
  };
}

/** Regista o consentimento RGPD (timestamp no servidor) — antes de recolher dados. */
export async function consentirPorToken(token: string): Promise<{ ok: boolean; error?: string }> {
  const s = await sessaoValida(token);
  if (!s) return { ok: false, error: "Link inválido ou expirado." };
  await supabaseAdmin
    .from("entrega_sessao")
    .update({ consentimento_em: new Date().toISOString(), estado: "aberto" })
    .eq("id", s.id);
  return { ok: true };
}

/** Assina um upload autorizado pelo TOKEN (não por sessão admin), com caminho estrito. */
export async function criarUploadPorToken(
  token: string,
  nomeFicheiro: string,
): Promise<{ ok: boolean; path?: string; uploadToken?: string; error?: string }> {
  const s = await sessaoValida(token);
  if (!s) return { ok: false, error: "Link inválido ou expirado." };
  if (!s.consentimento_em) return { ok: false, error: "Falta o consentimento." };

  const ext = (nomeFicheiro.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Allowlist no servidor: o cliente controla o nome, por isso a validação de
  // tipo do uploads.ts (browser) não basta. O bucket reforça tipo/tamanho.
  if (!["pdf", "jpg", "jpeg", "png", "webp"].includes(ext)) {
    return { ok: false, error: "Formato não suportado — usa foto (JPG/PNG) ou PDF." };
  }
  const caminho = `entregas/${s.id}/${randomBytes(8).toString("hex")}.${ext}`;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET_PRIVADO).createSignedUploadUrl(caminho);
  if (error || !data) {
    console.error("criarUploadPorToken error:", error);
    return { ok: false, error: "Erro ao preparar o upload." };
  }
  return { ok: true, path: data.path, uploadToken: data.token };
}

/**
 * Lê os documentos já carregados (por caminho no bucket) com o Gemini e devolve
 * os campos para pré-preencher o formulário. Autorizado pelo token da sessão e
 * restrito às imagens dessa sessão. Se não houver chave (GEMINI_API_KEY), devolve
 * semIA=true e o cliente recorre ao OCR do browser.
 */
export async function lerDocumentoIAporToken(
  token: string,
  paths: string[],
): Promise<{ ok: boolean; dados?: CamposDocumento; error?: string; semIA?: boolean; motivo?: string }> {
  const s = await sessaoValida(token);
  if (!s) return { ok: false, error: "Link inválido ou expirado.", motivo: "sessao" };
  if (!s.consentimento_em) return { ok: false, error: "Falta o consentimento.", motivo: "consentimento" };
  if (!geminiConfigurado()) {
    console.warn("lerDocumentoIA: GEMINI_API_KEY em falta — a usar Tesseract.");
    return { ok: false, semIA: true, motivo: "sem_chave" };
  }

  const imagens: { mime: string; base64: string }[] = [];
  let rejeitados = 0;
  for (const p of paths.slice(0, 4)) {
    // Segurança: só as imagens desta sessão (o caminho tem o id da sessão).
    if (!p.startsWith(`entregas/${s.id}/`)) { rejeitados++; continue; }
    const { data, error } = await supabaseAdmin.storage.from(BUCKET_PRIVADO).download(p);
    if (error || !data) { rejeitados++; continue; }
    const mime = mimeDoCaminho(p);
    if (!mime.startsWith("image/") && mime !== "application/pdf") { rejeitados++; continue; }
    const buf = Buffer.from(await data.arrayBuffer());
    imagens.push({ mime, base64: buf.toString("base64") });
  }
  console.log(`lerDocumentoIA: ${imagens.length} imagem(ns), ${rejeitados} rejeitada(s), sessão ${s.id}`);
  if (!imagens.length) return { ok: false, error: "Sem imagens para ler.", motivo: "sem_imagens" };

  const dados = await lerDocumentoGemini(imagens);
  if (!dados) return { ok: false, error: "Não consegui ler o documento.", motivo: "gemini_falhou" };
  console.log("lerDocumentoIA: leitura OK");
  return { ok: true, dados, motivo: "ok" };
}

export interface ConcluirEntregaInput {
  token: string;
  nome?: string | null;
  doc_id_tipo?: string | null;
  doc_id_numero?: string | null;
  doc_id_validade?: string | null;
  doc_paths: string[]; // caminhos privados dos documentos
  assinatura_path: string | null;
  regras_versao?: string | null;
  regras_hash?: string | null;
  carta_numero?: string | null;
  carta_categoria?: string | null;
  carta_pais?: string | null;
  carta_validade?: string | null;
}

/** Conclui o self-service: grava docs/dados no motorista + prova de aceite. */
export async function concluirPorToken(
  input: ConcluirEntregaInput,
): Promise<{ ok: boolean; error?: string }> {
  const s = await sessaoValida(input.token);
  if (!s) return { ok: false, error: "Link inválido ou expirado." };
  if (!s.consentimento_em) return { ok: false, error: "Falta o consentimento." };
  // Só a preparação de uma entrega (com contrato) exige aceitar as regras; o
  // registo puro recolhe apenas os dados.
  const precisaRegras = !!s.contrato_id;
  if (precisaRegras && !input.regras_versao) return { ok: false, error: "Falta aceitar as regras." };

  // A prova das regras é carimbada pelo SERVIDOR (a versão/hash reais da regra
  // ativa), nunca pelo que o cliente diz — senão a prova seria repudiável.
  const { data: regra } = await supabaseAdmin
    .from("regras_aluguer")
    .select("versao, hash")
    .eq("ativa", true)
    .maybeSingle();
  if (precisaRegras && !regra) return { ok: false, error: "Regras não configuradas." };

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const ua = h.get("user-agent") ?? null;
  const agora = new Date().toISOString();

  // Materializa no motorista os dados e documentos (sessão é âmbito estrito).
  if (s.motorista_id) {
    const upd: MotoristaUpdate = {};
    if (input.nome?.trim()) upd.nome = input.nome.trim();
    if (input.doc_id_tipo) upd.doc_id_tipo = input.doc_id_tipo as DocIdTipo;
    if (input.doc_id_numero?.trim()) upd.doc_id_numero = input.doc_id_numero.trim();
    if (input.doc_id_validade) upd.doc_id_validade = input.doc_id_validade;
    if (input.doc_paths.length) upd.doc_urls = input.doc_paths;
    if (Object.keys(upd).length) {
      await supabaseAdmin.from("motorista").update(upd).eq("id", s.motorista_id);
    }

    // Carta em separado: colunas recentes (fase4c) — se ainda não migradas, não
    // deve impedir a conclusão do onboarding.
    const cartaUpd: MotoristaUpdate = {};
    if (input.carta_numero?.trim()) cartaUpd.carta_numero = input.carta_numero.trim();
    if (input.carta_categoria?.trim()) cartaUpd.carta_categoria = input.carta_categoria.trim().toUpperCase();
    if (input.carta_pais?.trim()) cartaUpd.carta_pais = input.carta_pais.trim().toUpperCase();
    if (input.carta_validade) cartaUpd.carta_validade = input.carta_validade;
    if (Object.keys(cartaUpd).length) {
      const { error } = await supabaseAdmin.from("motorista").update(cartaUpd).eq("id", s.motorista_id);
      if (error) console.warn("concluirPorToken carta (migrar fase4c?):", error.message);
    }
  }

  const dados = {
    docs: input.doc_paths,
    assinatura_path: input.assinatura_path,
    // Prova de aceite só quando há regras (entrega); no registo fica null.
    regras:
      regra && input.regras_versao
        ? {
            versao: regra.versao, // do servidor, não do cliente
            hash: regra.hash,
            aceite: true,
            em: agora,
            ip,
            user_agent: ua,
          }
        : null,
  };
  await supabaseAdmin
    .from("entrega_sessao")
    .update({ estado: "concluido", concluido_em: agora, dados })
    .eq("id", s.id);

  // Avisa o gestor que há documentos/KYC por validar.
  if (s.motorista_id) {
    await notificar({
      tipo: "kyc_por_validar",
      titulo: "Documentos por validar — rever KYC",
      detalhe: input.nome?.trim() ? `Registo concluído: ${input.nome.trim()}` : "Registo por link concluído.",
      href: "/admin/motoristas",
      entidade: "motorista",
      entidade_id: s.motorista_id,
    });
  }

  return { ok: true };
}
