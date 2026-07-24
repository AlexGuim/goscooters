"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
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
): Promise<{ success: boolean; link?: string; error?: string }> {
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
  revalidatePath("/admin/contratos");
  return { success: true, link: `${origin}/entrega/${token}` };
}

// ── Público (validado por token, sem conta) ──────────────────────────────────

export interface SessaoPublica {
  motorista_nome: string;
  veiculo: string;
  consentiu: boolean;
  regras: { versao: string; hash: string; conteudo: string } | null;
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
      ? supabaseAdmin.from("motorista").select("nome").eq("id", s.motorista_id).maybeSingle()
      : Promise.resolve({ data: null }),
    s.contrato_id
      ? supabaseAdmin.from("contrato_aluguer").select("veiculo_id").eq("id", s.contrato_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  let veiculo = "a tua mota";
  if (c?.veiculo_id) {
    const { data: m } = await supabaseAdmin.from("moto").select("matricula, modelo").eq("id", c.veiculo_id).maybeSingle();
    if (m) veiculo = `${m.matricula ?? ""} ${m.modelo}`.trim();
  }
  const { data: regras } = await supabaseAdmin
    .from("regras_aluguer")
    .select("versao, hash, conteudo")
    .eq("ativa", true)
    .maybeSingle();

  return {
    ok: true,
    sessao: {
      motorista_nome: mot?.nome ?? "",
      veiculo,
      consentiu: !!s.consentimento_em,
      regras: regras ?? null,
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

  const ext = (nomeFicheiro.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const caminho = `entregas/${s.id}/${randomBytes(8).toString("hex")}.${ext}`;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET_PRIVADO).createSignedUploadUrl(caminho);
  if (error || !data) {
    console.error("criarUploadPorToken error:", error);
    return { ok: false, error: "Erro ao preparar o upload." };
  }
  return { ok: true, path: data.path, uploadToken: data.token };
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
}

/** Conclui o self-service: grava docs/dados no motorista + prova de aceite. */
export async function concluirPorToken(
  input: ConcluirEntregaInput,
): Promise<{ ok: boolean; error?: string }> {
  const s = await sessaoValida(input.token);
  if (!s) return { ok: false, error: "Link inválido ou expirado." };
  if (!s.consentimento_em) return { ok: false, error: "Falta o consentimento." };
  if (!input.regras_versao) return { ok: false, error: "Falta aceitar as regras." };

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
  }

  const dados = {
    docs: input.doc_paths,
    assinatura_path: input.assinatura_path,
    regras: {
      versao: input.regras_versao,
      hash: input.regras_hash ?? null,
      aceite: true,
      em: agora,
      ip,
      user_agent: ua,
    },
  };
  await supabaseAdmin
    .from("entrega_sessao")
    .update({ estado: "concluido", concluido_em: agora, dados })
    .eq("id", s.id);

  return { ok: true };
}
