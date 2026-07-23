"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { interpretarFatura, type FaturaCampos } from "@/lib/faturas";
import { encontrarMatricula } from "@/lib/matriculas";
import type { DespesaCategoria, ImputarA } from "@/types/db";

// Quem costuma suportar cada custo (igual ao default do formulário de despesas).
const IMPUTAR_PADRAO: Record<DespesaCategoria, ImputarA> = {
  manutencao: "proprietario",
  seguro: "proprietario",
  gps: "proprietario",
  portagem: "motorista",
  coima: "motorista",
  comissao: "goscooters",
  outro: "goscooters",
};

export interface LerFaturaResultado {
  campos: FaturaCampos;
  veiculo: { id: string; matricula: string | null; modelo: string } | null;
  proprietario: { id: string; nome: string; eh_goscooters: boolean } | null;
  imputar_a_sugerido: ImputarA;
  documento_url: string;
  texto_encontrado: boolean;
  /** Aviso quando a matrícula foi associada por aproximação (confirmar!). */
  aviso: string | null;
}

/**
 * Lê uma fatura já carregada no Storage (caminho `path`), extrai o texto (PDF
 * com camada de texto) e devolve os campos interpretados + o veículo associado.
 * NÃO grava nada — o admin revê e confirma depois.
 */
export async function lerFatura(
  path: string,
  documentoUrl: string,
): Promise<{ success: boolean; resultado?: LerFaturaResultado; semTexto?: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  // Imagens (fotos) não têm camada de texto: vão direto para OCR no cliente.
  const ePdf = path.toLowerCase().endsWith(".pdf");
  if (!ePdf) return { success: false, semTexto: true };

  const { data: blob, error: dlErr } = await supabaseAdmin.storage
    .from("motas")
    .download(path);
  if (dlErr || !blob) {
    console.error("lerFatura download error:", dlErr);
    return { success: false, error: "Não consegui abrir o ficheiro carregado." };
  }

  let texto = "";
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const buf = new Uint8Array(await blob.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const r = await extractText(pdf, { mergePages: true });
    texto = Array.isArray(r.text) ? r.text.join("\n") : r.text;
  } catch (e) {
    console.error("lerFatura extract error:", e);
    return { success: false, error: "Erro ao ler o PDF. Tenta outro ficheiro." };
  }

  if (texto.trim().length < 10) {
    return {
      success: false,
      semTexto: true,
      error:
        "Este PDF não tem texto legível (parece digitalizado). Vou tentar por OCR.",
    };
  }

  return { success: true, resultado: await montarResultado(texto, documentoUrl) };
}

/**
 * Interpreta o texto de uma fatura já reconhecido no cliente (OCR do browser)
 * e associa-o a um veículo. Usada para faturas digitalizadas / fotos.
 */
export async function interpretarTextoFatura(
  texto: string,
  documentoUrl: string,
): Promise<{ success: boolean; resultado?: LerFaturaResultado; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (texto.trim().length < 10) {
    return { success: false, error: "Não consegui reconhecer texto suficiente na fatura." };
  }
  return { success: true, resultado: await montarResultado(texto, documentoUrl) };
}

/** Interpreta o texto + associa veículo + sugere quem suporta o custo. */
async function montarResultado(texto: string, documentoUrl: string): Promise<LerFaturaResultado> {
  const campos = interpretarFatura(texto);

  // Associa a matrícula lida a um veículo da frota, tolerando erros de OCR.
  let veiculo: LerFaturaResultado["veiculo"] = null;
  let proprietario: LerFaturaResultado["proprietario"] = null;
  let aviso: string | null = null;
  if (campos.matricula) {
    const { data: motos } = await supabaseAdmin
      .from("moto")
      .select("id, matricula, matricula_norm, modelo, proprietario_id");
    const match = encontrarMatricula(campos.matricula, motos ?? []);
    if (match) {
      const m = (motos ?? []).find((x) => x.id === match.candidato.id)!;
      veiculo = { id: m.id, matricula: m.matricula, modelo: m.modelo };
      if (match.motivo !== "exata") {
        aviso = `Li a matrícula "${campos.matricula}" e associei a ${m.matricula} por semelhança — confirma se é o veículo certo.`;
      }
      if (m.proprietario_id) {
        const { data: dono } = await supabaseAdmin
          .from("proprietario")
          .select("id, nome, eh_goscooters")
          .eq("id", m.proprietario_id)
          .maybeSingle();
        if (dono)
          proprietario = {
            id: dono.id,
            nome: dono.nome,
            eh_goscooters: !!dono.eh_goscooters,
          };
      }
    }
  }

  // Sugestão de "quem suporta": frota própria → GoScooters; senão, o default da
  // categoria (manutenção/seguro/gps → proprietário, que ressarce no acerto).
  const imputar_a_sugerido: ImputarA = proprietario?.eh_goscooters
    ? "goscooters"
    : IMPUTAR_PADRAO[campos.categoria];

  return {
    campos,
    veiculo,
    proprietario,
    imputar_a_sugerido,
    documento_url: documentoUrl,
    texto_encontrado: true,
    aviso,
  };
}

export interface GravarFaturaInput {
  veiculo_id: string | null;
  categoria: DespesaCategoria;
  descricao: string | null;
  valor: string;
  data_despesa: string;
  data_vencimento: string | null;
  imputar_a: ImputarA;
  proprietario_id: string | null;
  fornecedor: string | null;
  referencia_externa: string | null;
  km: number | null;
  documento_url: string | null;
  detalhe: FaturaCampos | null;
}

/**
 * Grava a despesa vinda de uma fatura (origem = ingestão) e, se houver KM,
 * atualiza a moto e regista no histórico. A despesa entra no acerto pela via
 * normal (imputar_a = proprietário → ressarcido no fecho do mês).
 */
export async function gravarDespesaDeFatura(
  input: GravarFaturaInput,
): Promise<{ success: boolean; id?: string; error?: string; avisoKm?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!input.data_despesa) return { success: false, error: "A data é obrigatória." };
  const n = Number(input.valor);
  if (!Number.isFinite(n) || n < 0) return { success: false, error: "Indica um valor válido." };

  // Evita registar a mesma fatura duas vezes. Chave = fornecedor + referência +
  // valor: faturas diferentes do mesmo fornecedor com a mesma referência (ex.:
  // um "Processo Nº" repetido) mas valores distintos NÃO são bloqueadas.
  const fornecedor = input.fornecedor?.trim() || null;
  const referencia = input.referencia_externa?.trim() || null;
  if (fornecedor && referencia) {
    const { data: jaExiste } = await supabaseAdmin
      .from("despesa")
      .select("id")
      .eq("fornecedor", fornecedor)
      .eq("referencia_externa", referencia)
      .eq("valor", input.valor)
      .limit(1)
      .maybeSingle();
    if (jaExiste) {
      return {
        success: false,
        error: `Esta fatura já foi registada (${fornecedor}, ref. ${referencia}, €${input.valor}).`,
      };
    }
  }

  // Herda o dono do veículo se não vier explícito.
  let proprietario_id = input.proprietario_id ?? null;
  if (!proprietario_id && input.veiculo_id) {
    const { data: v } = await supabaseAdmin
      .from("moto")
      .select("proprietario_id")
      .eq("id", input.veiculo_id)
      .maybeSingle();
    proprietario_id = v?.proprietario_id ?? null;
  }

  const { data: despesa, error } = await supabaseAdmin
    .from("despesa")
    .insert({
      veiculo_id: input.veiculo_id ?? null,
      categoria: input.categoria,
      descricao: input.descricao?.trim() || null,
      valor: input.valor,
      data_despesa: input.data_despesa,
      data_vencimento: input.data_vencimento || null,
      estado_pagamento: "pendente",
      imputar_a: input.imputar_a,
      proprietario_id,
      fornecedor,
      referencia_externa: referencia,
      origem: "ingestao",
      detalhe: input.detalhe
        ? { ...input.detalhe, documento_url: input.documento_url ?? null }
        : input.documento_url
          ? { documento_url: input.documento_url }
          : null,
    })
    .select("id")
    .single();

  if (error || !despesa) {
    console.error("gravarDespesaDeFatura error:", error);
    return { success: false, error: "Erro ao gravar a despesa." };
  }

  // Atualiza a KM da moto (só se for maior que a atual) e regista no histórico.
  let avisoKm: string | undefined;
  if (input.veiculo_id && input.km && input.km > 0) {
    const { data: moto } = await supabaseAdmin
      .from("moto")
      .select("km_atual")
      .eq("id", input.veiculo_id)
      .maybeSingle();
    const atual = moto?.km_atual ?? null;
    if (atual == null || input.km >= atual) {
      await supabaseAdmin
        .from("moto")
        .update({ km_atual: input.km, km_atual_em: input.data_despesa })
        .eq("id", input.veiculo_id);
      await supabaseAdmin.from("km_registo").insert({
        veiculo_id: input.veiculo_id,
        km: input.km,
        data: input.data_despesa,
        fonte: "manutencao",
      });
    } else {
      avisoKm = `A KM da fatura (${input.km}) é menor que a registada (${atual}); não atualizei a moto.`;
    }
  }

  revalidatePath("/admin/despesas");
  revalidatePath("/admin/frota");
  return { success: true, id: despesa.id, avisoKm };
}
