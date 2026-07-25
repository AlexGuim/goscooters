"use server";

import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notificarNovoPedido } from "@/lib/notifications";
import { notificar } from "@/lib/notificacoes";
import { PERIODOS, duracaoPorExtenso } from "@/lib/precos";
import { getDicionario } from "@/lib/dictionaries";
import { isLocale, preencher, type Locale } from "@/lib/i18n";
import type { Database, Periodo } from "@/types/db";

type PedidoAluguerInsert = Database["public"]["Tables"]["pedido_aluguer"]["Insert"];

export interface CreatePedidoInput {
  motoId: string;
  nome: string;
  telefone: string;
  email?: string;
  plataforma: string;
  dataInicio?: string;
  periodo?: Periodo;
  duracao?: number;
  mensagem?: string;
  consentimento?: boolean;
  /** Idioma em que o cliente preencheu o formulário. */
  locale?: string;
}

export interface CreatePedidoResult {
  success: boolean;
  error?: string;
  pedidoId?: string;
  whatsappLink?: string;
}

export async function createPedido(
  input: CreatePedidoInput,
): Promise<CreatePedidoResult> {
  // As mensagens devolvidas ao cliente saem na língua em que ele está a navegar.
  const locale: Locale = isLocale(input.locale) ? input.locale : "pt";
  const dic = await getDicionario(locale);

  if (!input.nome?.trim()) {
    return { success: false, error: dic.erros.nomeObrigatorio };
  }

  if (!input.telefone?.trim()) {
    return { success: false, error: dic.erros.telefoneObrigatorio };
  }

  if (!input.plataforma?.trim()) {
    return { success: false, error: dic.erros.plataformaObrigatoria };
  }

  // O `required` do checkbox é do lado do cliente e contorna-se com facilidade;
  // sem consentimento não há base legal para guardar dados pessoais.
  if (!input.consentimento) {
    return {
      success: false,
      error: dic.erros.consentimentoObrigatorio,
    };
  }

  if (input.periodo && !PERIODOS.includes(input.periodo)) {
    return { success: false, error: dic.erros.periodoInvalido };
  }

  try {
    // O modelo é lido da base de dados e não do que o cliente enviou: assim a
    // notificação não pode ser forjada com um nome de mota inventado.
    const { data: moto } = await supabaseAdmin
      .from("moto")
      .select("modelo")
      .eq("id", input.motoId)
      .maybeSingle();

    const motoModelo = moto?.modelo ?? "Mota não identificada";

    const pedidoInsert: PedidoAluguerInsert = {
      moto_id: input.motoId,
      nome: input.nome.trim(),
      telefone: input.telefone.trim(),
      email: input.email?.trim() || null,
      plataforma: input.plataforma.trim(),
      data_inicio: input.dataInicio || null,
      duracao: input.duracao || null,
      periodo: input.periodo ?? null,
      mensagem: input.mensagem?.trim() || null,
      estado: "novo",
      // Prova de consentimento: acima já se garantiu que foi dado, aqui regista-se
      // quando. O RGPD exige poder demonstrá-lo, não só recolhê-lo.
      consentimento_em: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("pedido_aluguer")
      .insert(pedidoInsert)
      .select("id")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return { success: false, error: dic.erros.gravarPedido };
    }

    const duracaoTexto =
      input.duracao && input.periodo
        ? duracaoPorExtenso(input.duracao, input.periodo, dic.periodos)
        : null;

    // Avisa a equipa depois de a resposta seguir para o cliente: o lead já está
    // gravado, portanto não vale a pena fazer o utilizador esperar pelo email.
    after(async () => {
      await notificarNovoPedido({
        pedidoId: data.id,
        nome: input.nome.trim(),
        telefone: input.telefone.trim(),
        email: input.email?.trim() || null,
        motoModelo,
        plataforma: input.plataforma.trim(),
        dataInicio: input.dataInicio || null,
        duracaoTexto,
        mensagem: input.mensagem?.trim() || null,
      });
      // Item acionável na caixa do gestor (além do email/Telegram).
      await notificar({
        tipo: "novo_pedido",
        titulo: "Novo pedido de aluguer",
        detalhe: `${input.nome.trim()} · ${motoModelo}`,
        href: "/admin/pedidos",
        entidade: "pedido",
        entidade_id: data.id,
      });
    });

    // Mensagem para o cliente abrir a conversa connosco, escrita na perspectiva
    // dele — quem recebe o aviso interno somos nós, por email.
    const whatsappNumber =
      process.env.WHATSAPP_NUMERO?.replace(/\D/g, "") || "351912345678";
    const whatsappText = encodeURIComponent(
      preencher(dic.pedido.mensagemWhatsapp, {
        modelo: motoModelo,
        duracao: duracaoTexto ? ` (${duracaoTexto})` : "",
        nome: input.nome.trim(),
      }),
    );
    const whatsappLink = `https://wa.me/${whatsappNumber}?text=${whatsappText}`;

    return {
      success: true,
      pedidoId: data.id,
      whatsappLink,
    };
  } catch (err) {
    console.error("Error creating pedido:", err);
    return { success: false, error: dic.erros.inesperado };
  }
}
