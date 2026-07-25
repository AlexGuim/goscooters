"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { contratoDoVeiculoNaData } from "@/lib/contratoAtivo";
import { textoCoima } from "@/lib/lembretes";
import { enviarLembrete } from "@/lib/sms";
import { formatarPreco } from "@/lib/precos";
import { dataBR } from "@/lib/datas";
import { notificar } from "@/lib/notificacoes";

export interface RegistarCoimaInput {
  veiculo_id: string | null;
  valor: string;
  iva?: string | null;
  descricao?: string | null;
  data_despesa: string; // data do auto/documento
  data_infracao?: string | null; // data da infração (acha o condutor)
  pontos?: number | null;
  fornecedor?: string | null;
  referencia_externa?: string | null;
  // Se o admin já escolheu/confirmou o motorista, prevalece sobre a resolução.
  motorista_id?: string | null;
  gerar_divida?: boolean; // criar cobrança 'extra' ao motorista
  notificar?: boolean; // avisar o motorista
  data_vencimento?: string | null; // vencimento da dívida ao motorista
}

export interface ResolverCondutorResultado {
  ok: boolean;
  motorista_id?: string;
  motorista_nome?: string;
  contrato_numero?: string;
  error?: string;
}

/**
 * Descobre quem conduzia a mota numa data (para o formulário sugerir o condutor
 * antes de gravar a coima). Só de leitura.
 */
export async function resolverCondutor(
  veiculoId: string,
  data: string,
): Promise<ResolverCondutorResultado> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!veiculoId || !data) return { ok: false, error: "Indica o veículo e a data." };

  const c = await contratoDoVeiculoNaData(veiculoId, data);
  if (!c) return { ok: false, error: "Sem contrato ativo nessa data para este veículo." };
  return {
    ok: true,
    motorista_id: c.motorista_id,
    motorista_nome: c.motorista_nome,
    contrato_numero: c.contrato_numero,
  };
}

export interface RegistarCoimaResultado {
  success: boolean;
  id?: string;
  error?: string;
  motorista_nome?: string | null;
  contrato_numero?: string | null;
  divida_gerada?: boolean;
  valor_divida?: string;
  notificado?: "whatsapp" | "sms" | "nenhum" | null;
  aviso?: string;
}

/**
 * Regista uma coima e trata do procedimento automático: imputa ao motorista,
 * descobre o condutor pelo contrato na data da infração, gera-lhe a dívida
 * (cobrança 'extra') e, se pedido, notifica-o. A coima não é receita nem gera
 * comissão (o acerto só conta renda + imputar_a='proprietario').
 */
export async function registarCoima(
  input: RegistarCoimaInput,
): Promise<RegistarCoimaResultado> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const valorNum = Number(String(input.valor).replace(",", "."));
  if (!Number.isFinite(valorNum) || valorNum <= 0) {
    return { success: false, error: "Indica um valor válido." };
  }
  if (!input.data_despesa) return { success: false, error: "Indica a data do documento." };

  const valor = String(valorNum);
  const ivaNum = Number(String(input.iva ?? "").replace(",", ".")) || 0;
  const valorTotal = String(Math.round((valorNum + ivaNum) * 100) / 100);
  const dataResolucao = input.data_infracao || input.data_despesa;

  // 1. Resolver o condutor pelo contrato na data (se houver veículo).
  const condutor = input.veiculo_id
    ? await contratoDoVeiculoNaData(input.veiculo_id, dataResolucao)
    : null;
  const motoristaFinal = input.motorista_id ?? condutor?.motorista_id ?? null;
  const contratoId = condutor?.contrato_id ?? null;

  // Proprietário: do contrato, ou herdado do veículo (snapshot).
  let proprietarioId = condutor?.proprietario_id ?? null;
  let matricula: string | null = null;
  if (input.veiculo_id) {
    const { data: v } = await supabaseAdmin
      .from("moto")
      .select("proprietario_id, matricula")
      .eq("id", input.veiculo_id)
      .maybeSingle();
    proprietarioId = proprietarioId ?? v?.proprietario_id ?? null;
    matricula = v?.matricula ?? null;
  }

  // 2. Gravar a despesa (colunas garantidas — sem data_infracao/pontos ainda).
  const { data: despesa, error: eDesp } = await supabaseAdmin
    .from("despesa")
    .insert({
      veiculo_id: input.veiculo_id ?? null,
      categoria: "coima",
      descricao: input.descricao?.trim() || "Coima",
      valor,
      iva: ivaNum ? String(ivaNum) : null,
      data_despesa: input.data_despesa,
      estado_pagamento: "pendente",
      imputar_a: "motorista",
      proprietario_id: proprietarioId,
      motorista_id: motoristaFinal,
      contrato_id: contratoId,
      fornecedor: input.fornecedor?.trim() || null,
      referencia_externa: input.referencia_externa?.trim() || null,
    })
    .select("id")
    .single();

  if (eDesp || !despesa) {
    console.error("registarCoima despesa error:", eDesp);
    return { success: false, error: "Erro ao gravar a coima." };
  }

  // 3. Gravar data_infracao/pontos à parte — se a fase3f ainda não correu, avisa
  //    mas não falha (padrão migration-safe).
  const extra: { data_infracao?: string; pontos?: number } = {};
  if (input.data_infracao) extra.data_infracao = input.data_infracao;
  if (input.pontos != null) extra.pontos = input.pontos;
  if (Object.keys(extra).length) {
    const { error } = await supabaseAdmin.from("despesa").update(extra).eq("id", despesa.id);
    if (error) console.warn("registarCoima data_infracao/pontos (migrar fase3f?):", error.message);
  }

  const res: RegistarCoimaResultado = {
    success: true,
    id: despesa.id,
    motorista_nome: condutor?.motorista_nome ?? null,
    contrato_numero: condutor?.contrato_numero ?? null,
    divida_gerada: false,
    notificado: null,
  };

  // 4. Gerar a dívida ao motorista (cobrança 'extra'). Precisa de contrato.
  if (input.gerar_divida && motoristaFinal && input.veiculo_id && contratoId) {
    const { data: cob, error: eCob } = await supabaseAdmin
      .from("cobranca")
      .insert({
        contrato_id: contratoId,
        motorista_id: motoristaFinal,
        veiculo_id: input.veiculo_id,
        proprietario_id: proprietarioId,
        periodo_inicio: dataResolucao,
        periodo_fim: dataResolucao,
        data_vencimento: input.data_vencimento || new Date().toISOString().slice(0, 10),
        tipo: "extra",
        valor_devido: valorTotal,
        observacoes: `Coima ${input.descricao?.trim() || ""}`.trim(),
      })
      .select("id")
      .single();

    if (eCob || !cob) {
      console.warn("registarCoima cobrança extra:", eCob?.message);
      res.aviso = "A coima ficou registada, mas não consegui gerar a dívida ao motorista (verifica a migração fase3f).";
    } else {
      res.divida_gerada = true;
      res.valor_divida = valorTotal;
      const { error: eLink } = await supabaseAdmin
        .from("despesa")
        .update({ cobranca_id: cob.id })
        .eq("id", despesa.id);
      if (eLink) console.warn("registarCoima elo despesa→cobrança (migrar fase3f?):", eLink.message);
    }
  } else if (input.gerar_divida && !contratoId) {
    res.aviso = "Sem contrato ativo na data — a coima ficou registada, mas associa o motorista à mão para lhe cobrar.";
  }

  // 5. Notificar o motorista (opcional, fail-silent).
  if (input.notificar && motoristaFinal) {
    const { data: m } = await supabaseAdmin
      .from("motorista")
      .select("telefone_e164, idioma_preferido, nome")
      .eq("id", motoristaFinal)
      .maybeSingle();
    if (m?.telefone_e164) {
      try {
        const r = await enviarLembrete(
          m.telefone_e164,
          textoCoima(
            {
              nome: m.nome ?? "",
              matricula: matricula ?? "—",
              data: dataBR(dataResolucao),
              valor: formatarPreco(valorTotal),
            },
            m.idioma_preferido,
          ),
        );
        res.notificado = r.canal;
      } catch (err) {
        console.warn("registarCoima notificação falhou:", err);
        res.notificado = "nenhum";
      }
    } else {
      res.notificado = "nenhum";
    }
  }

  await notificar({
    tipo: "coima_reembolso",
    titulo: "Coima registada — reembolso a cobrar ao motorista",
    detalhe: `${formatarPreco(valorTotal)}${res.motorista_nome ? ` · ${res.motorista_nome}` : ""}`,
    href: "/admin/cobrancas",
    entidade: "despesa",
    entidade_id: despesa.id,
  });

  revalidatePath("/admin/despesas");
  revalidatePath("/admin/cobrancas");
  return res;
}
