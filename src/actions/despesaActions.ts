"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { garantirManutencaoDeDespesa } from "@/actions/frotaSaudeActions";
import { documentoDoDetalhe } from "@/lib/documentoDespesa";
import { documentoConformeCategoria, urlDocumentoParaAdmin } from "@/lib/documentoDespesaServidor";
import type {
  Database,
  DespesaCategoria,
  EstadoPagamentoDespesa,
  ImputarA,
} from "@/types/db";

type DespesaUpdate = Database["public"]["Tables"]["despesa"]["Update"];

export interface CriarDespesaInput {
  veiculo_id?: string | null;
  categoria: DespesaCategoria;
  descricao?: string | null;
  valor: string;
  iva?: string | null;
  data_despesa: string;
  data_vencimento?: string | null;
  estado_pagamento?: EstadoPagamentoDespesa;
  imputar_a: ImputarA;
  proprietario_id?: string | null;
  fornecedor?: string | null;
  referencia_externa?: string | null;
  recorrente?: boolean;
}

function valida(valor: string | undefined): string | null {
  if (valor === undefined) return null;
  const n = Number(valor);
  if (Number.isNaN(n) || n < 0) return "Indica um valor válido.";
  return null;
}

export async function criarDespesa(
  input: CriarDespesaInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!input.categoria) return { success: false, error: "Categoria é obrigatória." };
  if (!input.data_despesa) return { success: false, error: "Data é obrigatória." };
  const erro = valida(input.valor);
  if (erro) return { success: false, error: erro };

  // Se não vier proprietário mas houver veículo, herda o dono do veículo (snapshot).
  let proprietario_id = input.proprietario_id ?? null;
  if (!proprietario_id && input.veiculo_id) {
    const { data: v } = await supabaseAdmin
      .from("moto")
      .select("proprietario_id")
      .eq("id", input.veiculo_id)
      .maybeSingle();
    proprietario_id = v?.proprietario_id ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from("despesa")
    .insert({
      veiculo_id: input.veiculo_id ?? null,
      categoria: input.categoria,
      descricao: input.descricao?.trim() || null,
      valor: input.valor,
      iva: input.iva || null,
      data_despesa: input.data_despesa,
      data_vencimento: input.data_vencimento || null,
      estado_pagamento: input.estado_pagamento ?? "pendente",
      imputar_a: input.imputar_a,
      proprietario_id,
      fornecedor: input.fornecedor?.trim() || null,
      referencia_externa: input.referencia_externa?.trim() || null,
      recorrente: input.recorrente ?? false,
    })
    .select("id")
    .single();

  if (error) {
    console.error("criarDespesa error:", error);
    return { success: false, error: "Erro ao gravar a despesa." };
  }

  revalidatePath("/admin/despesas");
  // Uma despesa de manutenção espelha-se num registo operacional (painel de saúde
  // + alertas). Idempotente e best-effort — nunca falha a criação da despesa.
  if (input.categoria === "manutencao" && input.veiculo_id) {
    try {
      await garantirManutencaoDeDespesa(data.id);
    } catch (e) {
      console.error("garantirManutencaoDeDespesa (criarDespesa):", e);
    }
  }
  return { success: true, id: data.id };
}

export async function atualizarDespesa(
  id: string,
  updates: DespesaUpdate,
): Promise<{
  success: boolean;
  error?: string;
  documento_ver?: string | null;
  /** O original de uma coima/portagem ficou no bucket público depois de gravar: mostrar ao gestor. */
  aviso?: string;
}> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const erro = valida(updates.valor);
  if (erro) return { success: false, error: erro };

  // O documento segue a categoria que fica gravada: passar uma despesa a coima ou
  // portagem tira o aviso do bucket público, e o contrário devolve às faturas o
  // que a leitura tinha tomado por coima. Lê-se o que está na base — o formulário
  // de edição não traz o `detalhe`. Numa despesa antiga, o ficheiro no público pode
  // ser o único exemplar: é copiado e confirmado antes do update, e só sai do
  // público no `confirmar`, com a linha já gravada.
  const { data: atual, error: erroLer } = await supabaseAdmin
    .from("despesa")
    .select("categoria, detalhe")
    .eq("id", id)
    .maybeSingle();
  if (erroLer || !atual) {
    if (erroLer) console.error("atualizarDespesa (ler) error:", erroLer);
    return { success: false, error: "Não encontrei a despesa." };
  }
  const detalhe = updates.detalhe !== undefined ? updates.detalhe : atual.detalhe;
  const doc = await documentoConformeCategoria(
    documentoDoDetalhe(detalhe),
    updates.categoria ?? atual.categoria,
    id,
  );
  if (!doc.ok) return { success: false, error: doc.error };
  const final: DespesaUpdate = doc.mudou
    ? { ...updates, detalhe: { ...(detalhe as Record<string, unknown>), documento_url: doc.valor } }
    : updates;

  const { error } = await supabaseAdmin.from("despesa").update(final).eq("id", id);
  if (error) {
    console.error("atualizarDespesa error:", error);
    await doc.desfazer();
    return { success: false, error: "Erro ao atualizar a despesa." };
  }
  const aviso = await doc.confirmar();

  revalidatePath("/admin/despesas");
  const resposta = aviso ? { success: true, aviso } : { success: true };
  // O link da lista muda com o bucket: vai resolvido (assinado, se ficou privado).
  return doc.mudou ? { ...resposta, documento_ver: await urlDocumentoParaAdmin(doc.valor) } : resposta;
}

export async function eliminarDespesa(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin.from("despesa").delete().eq("id", id);
  if (error) {
    console.error("eliminarDespesa error:", error);
    return { success: false, error: "Erro ao eliminar a despesa." };
  }

  revalidatePath("/admin/despesas");
  return { success: true };
}
