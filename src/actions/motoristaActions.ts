"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { normalizarTelefone, paraE164 } from "@/lib/telefone";
import { kycCompleto, prontoParaEntrega } from "@/lib/kyc";
import type { AvaliacaoTipo, DocIdTipo, Motorista } from "@/types/db";

/** NIF português: 9 dígitos com checksum mod-11. */
function nifValidoPT(nif: string): boolean {
  const d = (nif ?? "").replace(/\D/g, "");
  if (d.length !== 9) return false;
  let soma = 0;
  for (let i = 0; i < 8; i++) soma += Number(d[i]) * (9 - i);
  const c = 11 - (soma % 11);
  return (c >= 10 ? 0 : c) === Number(d[8]);
}

/**
 * Registo privado de motoristas. Como toda a administração, cada ação verifica a
 * sessão — são endpoints HTTP públicos, não bastam botões escondidos.
 */

export interface MotoristaComResumo extends Motorista {
  positivas: number;
  negativas: number;
}

/** Resumo de um motorista pelo número de telefone, ou null se não existir. */
export async function procurarMotoristaPorTelefone(
  telefone: string,
): Promise<{ ok: boolean; motorista?: MotoristaComResumo | null; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const digitos = normalizarTelefone(telefone);
  if (!digitos) return { ok: true, motorista: null };

  const { data, error } = await supabaseAdmin
    .from("motorista")
    .select("*, avaliacao(tipo)")
    .eq("telefone_digitos", digitos)
    .maybeSingle();

  if (error) {
    console.error("procurarMotoristaPorTelefone error:", error);
    return { ok: false, error: "Erro ao procurar motorista." };
  }

  if (!data) return { ok: true, motorista: null };

  const registo = data as Motorista & { avaliacao?: { tipo: AvaliacaoTipo }[] };
  const avaliacoes = registo.avaliacao ?? [];

  return {
    ok: true,
    motorista: {
      ...(registo as Motorista),
      positivas: avaliacoes.filter((a) => a.tipo === "positiva").length,
      negativas: avaliacoes.filter((a) => a.tipo === "negativa").length,
    },
  };
}

export interface CriarMotoristaInput {
  nome: string;
  telefone: string;
  email?: string;
  plataforma?: string;
  notas?: string;
  // KYC opcional já na criação (colunas de fase1_nucleo).
  nif?: string | null;
  pais_iso?: string | null;
  morada_linha1?: string | null;
  codigo_postal?: string | null;
  localidade?: string | null;
  data_nascimento?: string | null;
  doc_id_tipo?: DocIdTipo | null;
  doc_id_numero?: string | null;
  doc_id_validade?: string | null;
}

export async function criarMotorista(
  input: CriarMotoristaInput,
): Promise<{ success: boolean; id?: string; error?: string; jaExistiaId?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const nome = input.nome?.trim();
  const telefone = input.telefone?.trim();

  if (!nome) return { success: false, error: "Nome é obrigatório." };
  if (!telefone) return { success: false, error: "Telefone é obrigatório." };

  const digitos = normalizarTelefone(telefone);

  // Evita duplicar quem já existe — devolve o existente para a UI o poder abrir.
  const { data: existente } = await supabaseAdmin
    .from("motorista")
    .select("id")
    .eq("telefone_digitos", digitos)
    .maybeSingle();

  if (existente) {
    return {
      success: false,
      error: "Já existe um motorista com este telefone.",
      jaExistiaId: existente.id,
    };
  }

  const nif = input.nif?.trim() || null;
  const nifDigitos = (nif ?? "").replace(/\D/g, "");

  const { data, error } = await supabaseAdmin
    .from("motorista")
    .insert({
      nome,
      telefone,
      telefone_digitos: digitos,
      telefone_e164: paraE164(telefone),
      email: input.email?.trim() || null,
      plataforma: input.plataforma?.trim() || null,
      notas: input.notas?.trim() || null,
      nif,
      nif_valido: nifDigitos.length === 9 ? nifValidoPT(nif ?? "") : null,
      pais_iso: input.pais_iso?.trim().toUpperCase() || null,
      morada_linha1: input.morada_linha1?.trim() || null,
      codigo_postal: input.codigo_postal?.trim() || null,
      localidade: input.localidade?.trim() || null,
      data_nascimento: input.data_nascimento || null,
      doc_id_tipo: input.doc_id_tipo || null,
      doc_id_numero: input.doc_id_numero?.trim() || null,
      doc_id_validade: input.doc_id_validade || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("criarMotorista error:", error);
    return { success: false, error: "Erro ao criar motorista." };
  }

  revalidatePath("/admin/motoristas");
  return { success: true, id: data.id };
}

export type MotoristaEditavel = Partial<
  Pick<
    Motorista,
    | "nome"
    | "telefone"
    | "email"
    | "plataforma"
    | "notas"
    | "nif"
    | "pais_iso"
    | "morada_linha1"
    | "codigo_postal"
    | "localidade"
    | "data_nascimento"
    | "estado"
    | "idioma_preferido"
    | "iban"
    | "doc_id_tipo"
    | "doc_id_numero"
    | "doc_id_validade"
    | "carta_numero"
    | "carta_categoria"
    | "carta_pais"
    | "carta_validade"
    | "precisa_revisao"
  >
>;

export type MotoristaDerivados = Partial<
  Pick<Motorista, "telefone_e164" | "telefone_digitos" | "nif_valido">
>;

export async function atualizarMotorista(
  id: string,
  updates: MotoristaEditavel,
): Promise<{ success: boolean; error?: string; derivados?: MotoristaDerivados }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  // Recalcula os campos derivados e devolve-os, para o cliente atualizar o ecrã
  // sem recarregar.
  const derivados: MotoristaDerivados = {};
  // Só recalcula o E.164 se o telefone foi de facto enviado (o cliente só o
  // envia quando muda), para não corromper um número estrangeiro já correcto.
  if ("telefone" in updates && typeof updates.telefone === "string") {
    derivados.telefone_digitos = normalizarTelefone(updates.telefone);
    derivados.telefone_e164 = paraE164(updates.telefone);
  }
  // "nif" in updates cobre também o apagar (nif=null), repondo nif_valido.
  if ("nif" in updates) {
    const d = (updates.nif ?? "").replace(/\D/g, "");
    derivados.nif_valido = d.length === 9 ? nifValidoPT(updates.nif ?? "") : null;
  }

  const CAMPOS_KYC = "nif, nif_valido, doc_id_numero, carta_numero, morada_linha1";
  // KYC ANTES de gravar — para saber se foi ESTA gravação a completar a identidade
  // (só aí faz sentido resolver o evento "por validar", que exige revisão humana).
  const { data: kycAntes } = await supabaseAdmin
    .from("motorista")
    .select(CAMPOS_KYC)
    .eq("id", id)
    .maybeSingle();
  const completoAntes = kycAntes ? kycCompleto(kycAntes).completo : false;

  const dados: Partial<Motorista> = { ...updates, ...derivados };
  const { error } = await supabaseAdmin.from("motorista").update(dados).eq("id", id);

  if (error) {
    console.error("atualizarMotorista error:", error);
    return { success: false, error: "Erro ao atualizar motorista." };
  }

  // Se a identidade ficou completa, atualiza a caixa do gestor sem ele ter de voltar
  // às notificações e clicar "Feito" (a notificação é só um atalho para a ficha).
  const { data: kycDepois } = await supabaseAdmin
    .from("motorista")
    .select(CAMPOS_KYC)
    .eq("id", id)
    .maybeSingle();
  if (kycDepois && kycCompleto(kycDepois).completo) {
    // kyc_incompleto é DERIVADA (reconciliada pelo cron): REMOVE-a em vez de a marcar
    // 'feita' — assim, se a identidade voltar a ficar incompleta, o cron re-alerta.
    await supabaseAdmin.from("notificacao").delete().eq("entidade_id", id).eq("tipo", "kyc_incompleto");
    // kyc_por_validar é um EVENTO que exige revisão humana: só o resolve se foi ESTA
    // gravação a completar a identidade (não uma edição de notas de um já completo).
    if (!completoAntes) {
      await supabaseAdmin
        .from("notificacao")
        .update({ estado: "feita", feita_em: new Date().toISOString(), feita_por: auth.user?.id ?? null })
        .eq("entidade_id", id)
        .eq("tipo", "kyc_por_validar")
        .neq("estado", "feita");
    }
  }

  revalidatePath("/admin/motoristas");
  return { success: true, derivados };
}

/**
 * O que ainda falta para PODER ENTREGAR a mota a este motorista — a definição
 * canónica (lib/kyc.ts), lida da BD e não do que o ecrã acha que gravou.
 * Serve o passo 3 do wizard para dizer a verdade em vez de uma lista fixa.
 */
export async function prontidaoEntrega(
  motoristaId: string,
): Promise<{ pronto: boolean; faltam: string[]; nome: string; erro?: string }> {
  const auth = await requireAdminForAction();
  // Um erro NÃO é "nada em falta": vai em `erro`, separado de `faltam`, para o
  // ecrã não mostrar tudo ✓ só porque a verificação falhou.
  if (!auth.ok) return { pronto: false, faltam: [], nome: "", erro: auth.error ?? "Sem sessão." };
  const { data: m } = await supabaseAdmin
    .from("motorista")
    .select("nome, nif, nif_valido, doc_id_numero, carta_numero, morada_linha1, doc_urls")
    .eq("id", motoristaId)
    .maybeSingle();
  if (!m) return { pronto: false, faltam: [], nome: "", erro: "Motorista não encontrado." };
  const r = prontoParaEntrega({ ...m, doc_urls: (m.doc_urls as string[] | null) ?? null });
  return { ...r, nome: m.nome ?? "" };
}

/**
 * Junta ficheiros de identidade à ficha — no servidor, a partir do que lá está
 * AGORA. O cliente não manda a lista inteira: uma lista feita a partir de uma
 * cópia antiga da ficha apagava o que outro ecrã (o link do motorista, outro
 * lote) tivesse entretanto acrescentado.
 */
export async function anexarDocumentosMotorista(
  motoristaId: string,
  paths: string[],
): Promise<{ success: boolean; error?: string; doc_urls?: string[] }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  const novos = paths.filter((p) => typeof p === "string" && p.trim());
  const { data: m } = await supabaseAdmin
    .from("motorista")
    .select("doc_urls")
    .eq("id", motoristaId)
    .maybeSingle();
  if (!m) return { success: false, error: "Motorista não encontrado." };
  const atuais = (m.doc_urls as string[] | null) ?? [];
  const doc_urls = [...atuais, ...novos.filter((p) => !atuais.includes(p))];
  if (doc_urls.length === atuais.length) return { success: true, doc_urls };
  const { error } = await supabaseAdmin.from("motorista").update({ doc_urls }).eq("id", motoristaId);
  if (error) {
    console.error("anexarDocumentosMotorista error:", error);
    return { success: false, error: "Erro ao guardar os documentos na ficha." };
  }
  revalidatePath("/admin/motoristas");
  revalidatePath("/admin/documentos");
  return { success: true, doc_urls };
}

export async function eliminarMotorista(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  // As avaliações caem com o motorista (on delete cascade).
  const { error } = await supabaseAdmin.from("motorista").delete().eq("id", id);

  if (error) {
    console.error("eliminarMotorista error:", error);
    return { success: false, error: "Erro ao eliminar motorista." };
  }

  revalidatePath("/admin/motoristas");
  return { success: true };
}

export interface CriarAvaliacaoInput {
  motoristaId: string;
  tipo: AvaliacaoTipo;
  nota?: number | null;
  comentario?: string;
  dataAluguer?: string;
}

export async function criarAvaliacao(
  input: CriarAvaliacaoInput,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!["positiva", "negativa", "neutra"].includes(input.tipo)) {
    return { success: false, error: "Tipo de avaliação inválido." };
  }

  const { error } = await supabaseAdmin.from("avaliacao").insert({
    motorista_id: input.motoristaId,
    tipo: input.tipo,
    nota: input.nota ?? null,
    comentario: input.comentario?.trim() || null,
    data_aluguer: input.dataAluguer || null,
  });

  if (error) {
    console.error("criarAvaliacao error:", error);
    return { success: false, error: "Erro ao gravar avaliação." };
  }

  revalidatePath("/admin/motoristas");
  return { success: true };
}

export async function eliminarAvaliacao(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin.from("avaliacao").delete().eq("id", id);

  if (error) {
    console.error("eliminarAvaliacao error:", error);
    return { success: false, error: "Erro ao eliminar avaliação." };
  }

  revalidatePath("/admin/motoristas");
  return { success: true };
}
