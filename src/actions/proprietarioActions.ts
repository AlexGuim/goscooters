"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction, COOKIE_PREVIEW } from "@/lib/dal";
import { faltaColunaOuTabela } from "@/lib/erroSupabase";
import { mesmoDocumento } from "@/lib/documentoIdentidade";
import type { Database, DocIdTipo, TipoPessoa } from "@/types/db";

type ProprietarioUpdate = Database["public"]["Tables"]["proprietario"]["Update"];

/**
 * Gestão de proprietários (parceiros-donos). Como toda a administração, cada
 * ação verifica a sessão — são endpoints HTTP públicos.
 */

export interface CriarProprietarioInput {
  nome: string;
  email?: string | null;
  telefone?: string | null;
  nif?: string | null;
  iban?: string | null;
  // numeric no Postgres → guardado como string, como os preços.
  comissao_valor?: string | number | null;
  eh_goscooters?: boolean;
  recebe_pagamento_direto?: boolean;
  tipo_parceiro?: "gerido" | "anunciante";
  tipo_pessoa?: TipoPessoa;
  morada?: string | null;
  // Para o F306 das coimas (fase16), quando o dono é pessoa singular.
  titular_nome?: string | null;
  doc_id_tipo?: DocIdTipo | null;
  doc_id_numero?: string | null;
  doc_id_emissao?: string | null;
  doc_id_emissor?: string | null;
  carta_numero?: string | null;
}

/**
 * Colunas da fase16 (F306 das coimas). Gravam-se à parte, depois da ficha base,
 * para o nome, o NIF, o IBAN e a comissão gravarem mesmo sem a migração.
 */
const CAMPOS_IDENTIFICACAO = [
  "titular_nome",
  "doc_id_tipo",
  "doc_id_numero",
  "doc_id_validade",
  "doc_id_emissao",
  "doc_id_emissor",
  "carta_numero",
  "carta_validade",
] as const satisfies readonly (keyof ProprietarioUpdate)[];

type Identificacao = Pick<ProprietarioUpdate, (typeof CAMPOS_IDENTIFICACAO)[number]>;

/**
 * Grava a identificação de um proprietário que já está gravado. Sem a migração só
 * avisa; outro erro devolve a mensagem, para o ecrã não dizer que ficou tudo gravado.
 */
async function gravarIdentificacao(id: string, dados: Identificacao, contexto: string): Promise<string | null> {
  if (!Object.keys(dados).length) return null;
  const { error } = await supabaseAdmin.from("proprietario").update(dados).eq("id", id);
  if (!error) return null;
  if (faltaColunaOuTabela(error)) {
    console.warn(`${contexto} identificação (migrar fase16?):`, error.message);
    return null;
  }
  console.error(`${contexto} identificação error:`, error);
  return "O proprietário ficou gravado, mas o titular, o documento e a carta não: confirma a data de emissão e grava outra vez em Editar.";
}

export async function criarProprietario(
  input: CriarProprietarioInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const nome = input.nome?.trim();
  if (!nome) return { success: false, error: "Nome é obrigatório." };

  const { data, error } = await supabaseAdmin
    .from("proprietario")
    .insert({
      nome,
      email: input.email?.trim() || null,
      telefone: input.telefone?.trim() || null,
      nif: input.nif?.trim() || null,
      iban: input.iban?.trim() || null,
      comissao_modelo: "percentagem",
      comissao_valor: input.comissao_valor != null ? String(input.comissao_valor) : null,
      eh_goscooters: input.eh_goscooters ?? false,
      recebe_pagamento_direto: input.recebe_pagamento_direto ?? false,
      tipo_parceiro: input.tipo_parceiro ?? "gerido",
      tipo_pessoa: input.tipo_pessoa ?? "singular",
      morada: input.morada?.trim() || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("criarProprietario error:", error);
    return { success: false, error: "Erro ao criar proprietário." };
  }

  // Numa ficha nova só segue o que vem preenchido: o resto já nasce vazio.
  const docNumero = input.doc_id_numero?.trim();
  const erroIdentificacao = await gravarIdentificacao(
    data.id,
    {
      ...(input.titular_nome?.trim() ? { titular_nome: input.titular_nome.trim() } : {}),
      ...(docNumero
        ? {
            doc_id_tipo: input.doc_id_tipo ?? "cc",
            doc_id_numero: docNumero,
            ...(input.doc_id_emissao ? { doc_id_emissao: input.doc_id_emissao } : {}),
            ...(input.doc_id_emissor?.trim() ? { doc_id_emissor: input.doc_id_emissor.trim() } : {}),
          }
        : {}),
      ...(input.carta_numero?.trim() ? { carta_numero: input.carta_numero.trim() } : {}),
    },
    "criarProprietario",
  );

  revalidatePath("/admin/proprietarios");
  // O id segue mesmo com erro: a ficha existe, e o ecrã não a pode criar outra vez.
  if (erroIdentificacao) return { success: false, id: data.id, error: erroIdentificacao };
  return { success: true, id: data.id };
}

export async function atualizarProprietario(
  id: string,
  updates: ProprietarioUpdate,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const base: ProprietarioUpdate = { ...updates };
  const identificacao: Identificacao = {};
  for (const campo of CAMPOS_IDENTIFICACAO) {
    if (!(campo in base)) continue;
    Object.assign(identificacao, { [campo]: base[campo] });
    delete base[campo];
  }

  // Outro documento: a data e o emissor do anterior deixam de valer — no F306 vão ao
  // lado do número. A regra de atualizarMotorista: só fica o que vier com o número novo.
  if ("doc_id_numero" in identificacao) {
    const { data: antes } = await supabaseAdmin
      .from("proprietario")
      .select("doc_id_numero")
      .eq("id", id)
      .maybeSingle();
    if (!mesmoDocumento(identificacao.doc_id_numero, antes?.doc_id_numero)) {
      if (!("doc_id_emissao" in identificacao)) identificacao.doc_id_emissao = null;
      if (!("doc_id_emissor" in identificacao)) identificacao.doc_id_emissor = null;
    }
  }

  if (Object.keys(base).length) {
    const { error } = await supabaseAdmin.from("proprietario").update(base).eq("id", id);
    if (error) {
      console.error("atualizarProprietario error:", error);
      return { success: false, error: "Erro ao atualizar proprietário." };
    }
  }
  const erroIdentificacao = await gravarIdentificacao(id, identificacao, "atualizarProprietario");

  revalidatePath("/admin/proprietarios");
  revalidatePath("/admin/motas");
  if (erroIdentificacao) return { success: false, error: erroIdentificacao };
  return { success: true };
}

/**
 * Convida um parceiro para o portal: cria (ou reutiliza) o utilizador Supabase
 * Auth por email, liga-o ao proprietário (auth_user_id) e ativa o portal. O
 * parceiro recebe um email com um link que o autentica e o leva a /portal.
 */
async function encontrarUtilizador(mail: string): Promise<string | null> {
  const { data } = await supabaseAdmin.auth.admin.listUsers();
  return data?.users.find((u) => u.email?.toLowerCase() === mail)?.id ?? null;
}

export async function convidarParceiro(
  proprietarioId: string,
  email: string,
  password?: string,
): Promise<{ success: boolean; error?: string; via?: "password" | "email" }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const mail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
    return { success: false, error: "Indica um email válido." };
  }
  const pw = password?.trim() || "";
  if (pw && pw.length < 6) {
    return { success: false, error: "A palavra-passe tem de ter pelo menos 6 caracteres." };
  }

  let userId: string | null = null;
  const via: "password" | "email" = pw ? "password" : "email";

  if (pw) {
    // Com palavra-passe: cria (ou define no existente) SEM enviar email — imune
    // ao rate limit do email e permite entrar logo com email + palavra-passe.
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: mail,
      password: pw,
      email_confirm: true,
    });
    if (error) {
      if (!/already|exist|registered/i.test(error.message)) {
        console.error("convidarParceiro createUser error:", error);
        return { success: false, error: "Não foi possível criar o acesso." };
      }
      userId = await encontrarUtilizador(mail);
      if (userId) await supabaseAdmin.auth.admin.updateUserById(userId, { password: pw });
    } else {
      userId = data.user?.id ?? null;
    }
  } else {
    // Sem palavra-passe: convite por email (link de acesso).
    const h = await headers();
    const origin = h.get("origin") ?? `https://${h.get("host") ?? "goscooters.vercel.app"}`;
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(mail, {
      redirectTo: `${origin}/auth/callback?next=/portal`,
    });
    if (error) {
      if (!/already|exist|registered/i.test(error.message)) {
        console.error("convidarParceiro invite error:", error);
        return { success: false, error: "Não foi possível enviar o convite (verifica o SMTP no Supabase)." };
      }
      userId = await encontrarUtilizador(mail);
    } else {
      userId = data.user?.id ?? null;
    }
  }

  if (!userId) return { success: false, error: "Não consegui obter o utilizador do parceiro." };

  const { error: upErr } = await supabaseAdmin
    .from("proprietario")
    .update({ auth_user_id: userId, portal_ativo: true, email: mail })
    .eq("id", proprietarioId);
  if (upErr) {
    console.error("convidarParceiro link error:", upErr);
    return { success: false, error: "Este utilizador já está ligado a outro proprietário." };
  }

  revalidatePath("/admin/proprietarios");
  return { success: true, via };
}

/** Revoga o acesso do parceiro ao portal (mantém o vínculo Auth). */
export async function revogarPortal(
  proprietarioId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin
    .from("proprietario")
    .update({ portal_ativo: false })
    .eq("id", proprietarioId);
  if (error) return { success: false, error: "Erro ao revogar o acesso." };

  revalidatePath("/admin/proprietarios");
  return { success: true };
}

export async function eliminarProprietario(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  // Só elimina se não houver veículos ligados — evita órfãos silenciosos.
  const { count, error: countErr } = await supabaseAdmin
    .from("moto")
    .select("id", { count: "exact", head: true })
    .eq("proprietario_id", id);

  if (countErr) {
    console.error("eliminarProprietario count error:", countErr);
    return { success: false, error: "Não foi possível verificar os veículos associados." };
  }

  if (count && count > 0) {
    return {
      success: false,
      error: `Não é possível eliminar: tem ${count} veículo(s) associado(s).`,
    };
  }

  const { error } = await supabaseAdmin.from("proprietario").delete().eq("id", id);
  if (error) {
    console.error("eliminarProprietario error:", error);
    return { success: false, error: "Erro ao eliminar proprietário." };
  }

  revalidatePath("/admin/proprietarios");
  return { success: true };
}

/**
 * Pré-visualização do portal: o admin passa a VER o portal como um parceiro.
 *
 * Quem autoriza é a allowlist de admin, verificada no servidor — o cookie só
 * escolhe QUAL o parceiro, e não vale nada para quem não é admin. É por isso
 * que o âmbito continua a não vir de um id no URL: vem da sessão (admin) mais
 * uma escolha explícita.
 *
 * Só leitura: `requirePartnerForAction` recusa qualquer acção neste modo.
 */
export async function verPortalComo(
  proprietarioId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data: dono } = await supabaseAdmin
    .from("proprietario")
    .select("id, eh_goscooters")
    .eq("id", proprietarioId)
    .maybeSingle();
  if (!dono) return { success: false, error: "Parceiro não encontrado." };
  if (dono.eh_goscooters) {
    return { success: false, error: "A frota própria não tem portal de parceiro." };
  }

  (await cookies()).set(COOKIE_PREVIEW, dono.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // uma hora: é para espreitar, não para trabalhar
  });
  return { success: true };
}

/** Sai da pré-visualização (o admin volta a não ter portal). */
export async function sairDaPrevisualizacao(): Promise<{ success: boolean }> {
  (await cookies()).delete(COOKIE_PREVIEW);
  return { success: true };
}
