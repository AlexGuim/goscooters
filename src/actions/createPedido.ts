"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Database, PedidoAluguer } from "@/types/db";

type PedidoAluguerInsert = Database["public"]["Tables"]["pedido_aluguer"]["Insert"];

export interface CreatePedidoInput {
  motoId: string;
  motoModelo: string;
  nome: string;
  telefone: string;
  email?: string;
  plataforma: string;
  dataInicio?: string;
  duracaoMeses?: number;
  mensagem?: string;
  consentimento?: boolean;
}

export interface CreatePedidoResult {
  success: boolean;
  error?: string;
  pedidoId?: string;
  whatsappLink?: string;
}

export async function createPedido(input: CreatePedidoInput): Promise<CreatePedidoResult> {
  // Validação de campos obrigatórios
  if (!input.nome?.trim()) {
    return { success: false, error: "Nome é obrigatório." };
  }

  if (!input.telefone?.trim()) {
    return { success: false, error: "Telefone é obrigatório." };
  }

  if (!input.plataforma?.trim()) {
    return { success: false, error: "Plataforma é obrigatória." };
  }

  // O `required` do checkbox é do lado do cliente e contorna-se com facilidade;
  // sem consentimento não há base legal para guardar dados pessoais.
  if (!input.consentimento) {
    return {
      success: false,
      error: "É necessário autorizar o tratamento dos dados para continuar.",
    };
  }

  try {
    // Insere em pedido_aluguer com o cliente admin
    const pedidoInsert: PedidoAluguerInsert = {
      moto_id: input.motoId,
      nome: input.nome.trim(),
      telefone: input.telefone.trim(),
      email: input.email?.trim() || null,
      plataforma: input.plataforma.trim(),
      data_inicio: input.dataInicio || null,
      duracao_meses: input.duracaoMeses || null,
      mensagem: input.mensagem?.trim() || null,
      estado: "novo",
    };

    const { data, error } = await supabaseAdmin
      .from("pedido_aluguer")
      .insert(pedidoInsert)
      .select("id")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return { success: false, error: "Erro ao gravar pedido. Tenta novamente." };
    }

    // Gera mensagem WhatsApp para o admin
    const whatsappNumber = process.env.WHATSAPP_NUMERO?.replace(/\D/g, "") || "351912345678";
    const whatsappText = encodeURIComponent(
      `Novo pedido de aluguer!\n\nNome: ${input.nome}\nTelefone: ${input.telefone}\nMoto: ${input.motoModelo}\nPlataforma: ${input.plataforma}\nData início: ${input.dataInicio || "—"}\nDuração: ${input.duracaoMeses || "—"} meses\nMensagem: ${input.mensagem || "—"}`,
    );
    const whatsappLink = `https://wa.me/${whatsappNumber}?text=${whatsappText}`;

    return {
      success: true,
      pedidoId: data.id,
      whatsappLink,
    };
  } catch (err) {
    console.error("Error creating pedido:", err);
    return { success: false, error: "Erro inesperado. Tenta novamente." };
  }
}
