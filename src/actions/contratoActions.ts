"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { notificar } from "@/lib/notificacoes";
import { ocuparMota, libertarMota } from "@/lib/motaEstado";
import type { ContratoEstado, Database, Periodicidade } from "@/types/db";

type ContratoUpdate = Database["public"]["Tables"]["contrato_aluguer"]["Update"];

export interface CriarContratoInput {
  motorista_id: string;
  // Opcionais: um 'pre_contrato' nasce só com o motorista. A partir de 'rascunho'
  // são obrigatórios (validado abaixo + invariante contrato_pronto_se_ativo).
  veiculo_id?: string | null;
  proprietario_id?: string | null;
  periodicidade?: Periodicidade;
  dia_vencimento?: number | null;
  preco_periodo?: string | null;
  caucao?: string | null;
  data_inicio?: string | null;
  ancora_vencimento?: string | null;
  estado: ContratoEstado;
  observacoes?: string | null;
  pedido_aluguer_id?: string | null;
}

function validar(
  input: Partial<CriarContratoInput>,
): string | null {
  if (input.preco_periodo !== undefined) {
    const n = Number(input.preco_periodo);
    if (Number.isNaN(n) || n <= 0) return "Indica um preço válido.";
  }
  return null;
}

export async function criarContrato(
  input: CriarContratoInput,
): Promise<{ success: boolean; id?: string; numero?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!input.motorista_id) return { success: false, error: "Cliente é obrigatório." };
  // Só o pré-contrato pode nascer sem mota/preço/data.
  const preContrato = input.estado === "pre_contrato";
  if (!preContrato) {
    if (!input.veiculo_id) return { success: false, error: "Veículo é obrigatório." };
    if (!input.data_inicio) return { success: false, error: "Data de início é obrigatória." };
    if (!input.preco_periodo) return { success: false, error: "Preço é obrigatório." };
  }
  const erro = validar(input);
  if (erro) return { success: false, error: erro };

  const { data, error } = await supabaseAdmin
    .from("contrato_aluguer")
    .insert({ ...input, proprietario_id: input.proprietario_id ?? null })
    .select("id, numero")
    .single();

  if (error || !data) {
    // Corrida no índice único (um pré-contrato por motorista): reutiliza o aberto.
    if (preContrato && error?.code === "23505") {
      const { data: re } = await supabaseAdmin
        .from("contrato_aluguer")
        .select("id, numero")
        .eq("motorista_id", input.motorista_id)
        .eq("estado", "pre_contrato")
        .maybeSingle();
      if (re) return { success: true, id: re.id, numero: re.numero };
    }
    console.error("criarContrato error:", error);
    return { success: false, error: "Erro ao criar contrato." };
  }

  // Um contrato ativo ocupa o veículo e promove o motorista lead→ativo (a
  // promoção deixa de estar acoplada só à vistoria de entrega).
  if (input.estado === "ativo") {
    if (input.veiculo_id) {
      await ocuparMota(input.veiculo_id);
    }
    await supabaseAdmin
      .from("motorista")
      .update({ estado: "ativo" })
      .eq("id", input.motorista_id)
      .eq("estado", "lead");
  }

  // Uma jornada aberta sem mota gera um item na caixa do gestor.
  if (preContrato) {
    await notificar({
      tipo: "pre_contrato_sem_mota",
      titulo: "Pré-contrato à espera de mota",
      detalhe: `Jornada ${data.numero} aberta — atribuir mota, preço e data.`,
      href: "/admin/contratos",
      entidade: "contrato",
      entidade_id: data.id,
    });
  }

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/motas");
  return { success: true, id: data.id, numero: data.numero };
}

export interface FinalizarPreContratoInput {
  veiculo_id: string;
  proprietario_id?: string | null;
  periodicidade?: Periodicidade;
  dia_vencimento?: number | null;
  preco_periodo: string;
  caucao?: string | null;
  data_inicio: string;
  ancora_vencimento?: string | null;
  observacoes?: string | null;
}

/**
 * Finaliza um pré-contrato: dá-lhe mota+preço+data e passa-o a 'rascunho' (pronto
 * a entregar). Congela o proprietário a partir do veículo. Só age sobre um
 * 'pre_contrato' (guarda de transição), resolve a notificação de "à espera de
 * mota" e cria a de "contrato pronto — agendar entrega".
 */
export async function finalizarPreContrato(
  id: string,
  input: FinalizarPreContratoInput,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.veiculo_id) return { success: false, error: "Veículo é obrigatório." };
  if (!input.data_inicio) return { success: false, error: "Data de início é obrigatória." };
  if (!input.preco_periodo) return { success: false, error: "Preço é obrigatório." };
  const erro = validar(input);
  if (erro) return { success: false, error: erro };

  // Snapshot do proprietário à data (do veículo, se não vier explícito).
  let proprietario_id = input.proprietario_id ?? null;
  if (!proprietario_id) {
    const { data: v } = await supabaseAdmin
      .from("moto")
      .select("proprietario_id")
      .eq("id", input.veiculo_id)
      .maybeSingle();
    proprietario_id = v?.proprietario_id ?? null;
  }

  const upd: ContratoUpdate = {
    veiculo_id: input.veiculo_id,
    proprietario_id,
    preco_periodo: input.preco_periodo,
    data_inicio: input.data_inicio,
    estado: "rascunho",
  };
  if (input.periodicidade) upd.periodicidade = input.periodicidade;
  if (input.dia_vencimento !== undefined) upd.dia_vencimento = input.dia_vencimento;
  if (input.caucao !== undefined) upd.caucao = input.caucao;
  if (input.ancora_vencimento !== undefined) upd.ancora_vencimento = input.ancora_vencimento;
  if (input.observacoes !== undefined) upd.observacoes = input.observacoes;

  const { data, error } = await supabaseAdmin
    .from("contrato_aluguer")
    .update(upd)
    .eq("id", id)
    .eq("estado", "pre_contrato") // guarda: só finaliza um pré-contrato
    .select("id, numero, motorista_id")
    .maybeSingle();
  if (error) {
    console.error("finalizarPreContrato error:", error);
    return { success: false, error: "Erro ao finalizar o pré-contrato." };
  }
  if (!data) return { success: false, error: "Este contrato já não é um pré-contrato." };

  // Materializa a caução como uma cobrança própria (tipo 'caucao') — fica visível
  // nas dívidas para cobrar na entrega. Não conta como receita (o financeiro só
  // considera 'renda') nem colide com o dano na recolha (despesa à parte). O
  // guard de estado acima garante que isto corre uma só vez por contrato.
  const valorCaucao = Number((input.caucao ?? "").toString().replace(",", "."));
  if (Number.isFinite(valorCaucao) && valorCaucao > 0) {
    const { data: jaCaucao } = await supabaseAdmin
      .from("cobranca")
      .select("id")
      .eq("contrato_id", id)
      .eq("tipo", "caucao")
      .maybeSingle();
    if (!jaCaucao) {
      const { error: eCau } = await supabaseAdmin.from("cobranca").insert({
        contrato_id: id,
        motorista_id: data.motorista_id,
        veiculo_id: input.veiculo_id,
        proprietario_id,
        periodo_inicio: input.data_inicio,
        periodo_fim: input.data_inicio,
        data_vencimento: input.data_inicio,
        tipo: "caucao",
        valor_devido: String(valorCaucao),
        observacoes: "Caução do contrato (a cobrar na entrega)",
      });
      if (eCau) console.warn("finalizarPreContrato caução:", eCau.message);
    }
  }

  // Resolve a notificação de "à espera de mota" e cria "contrato pronto".
  await supabaseAdmin
    .from("notificacao")
    .update({ estado: "feita", feita_em: new Date().toISOString() })
    .eq("entidade_id", id)
    .eq("tipo", "pre_contrato_sem_mota")
    .neq("estado", "feita");
  await notificar({
    tipo: "contrato_pronto",
    titulo: "Contrato pronto — agendar entrega",
    detalhe: `Contrato ${data.numero} finalizado. Enviar link de entrega / agendar.`,
    href: "/admin/contratos",
    entidade: "contrato",
    entidade_id: id,
  });

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/motas");
  return { success: true };
}

/**
 * Descarta um pré-contrato abandonado (cliente desapareceu antes de haver mota):
 * passa-o a 'cancelado' (o invariante isenta 'cancelado') e resolve a notificação
 * de "à espera de mota". Só age sobre um 'pre_contrato' (guarda de transição).
 */
export async function descartarPreContrato(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data, error } = await supabaseAdmin
    .from("contrato_aluguer")
    .update({ estado: "cancelado" })
    .eq("id", id)
    .eq("estado", "pre_contrato")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("descartarPreContrato error:", error);
    return { success: false, error: "Erro ao descartar o pré-contrato." };
  }
  if (!data) return { success: false, error: "Este contrato já não é um pré-contrato." };

  await supabaseAdmin
    .from("notificacao")
    .update({ estado: "feita", feita_em: new Date().toISOString() })
    .eq("entidade_id", id)
    .eq("tipo", "pre_contrato_sem_mota")
    .neq("estado", "feita");

  revalidatePath("/admin/contratos");
  return { success: true };
}

/**
 * A cobrança SEGUE o contrato: as rendas ainda POR PAGAR (valor_pago=0, estado
 * 'por_liquidar') passam a apontar para a mota atual do contrato e o seu dono. Assim
 * o painel de cobrança, o financeiro e o acerto batem sempre certo com o contrato,
 * mesmo quando a mota foi trocada depois de as cobranças existirem.
 *
 * SÓ as 'por_liquidar' (nunca as 'parcial'/pagas): uma renda com pagamento já tem
 * receita reconhecida e pode estar (ou vir a estar, em corrida com um fecho) num
 * acerto — reapontá-la arriscaria dupla contagem entre acertos. As por_liquidar
 * nunca entram num acerto (o cálculo só conta valor_pago>0), por isso é seguro e
 * dispensa qualquer verificação de acerto. A caução/coima (tipo != renda) não migram
 * — são eventos ligados à mota da altura. Idempotente (UPDATE único e atómico).
 */
async function reconciliarCobrancasComContrato(contratoId: string): Promise<void> {
  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("veiculo_id")
    .eq("id", contratoId)
    .maybeSingle();
  if (!c?.veiculo_id) return;
  const { data: mota } = await supabaseAdmin
    .from("moto")
    .select("proprietario_id")
    .eq("id", c.veiculo_id)
    .maybeSingle();
  await supabaseAdmin
    .from("cobranca")
    .update({ veiculo_id: c.veiculo_id, proprietario_id: mota?.proprietario_id ?? null })
    .eq("contrato_id", contratoId)
    .eq("tipo", "renda")
    .eq("estado_liquidacao", "por_liquidar");
}

export async function atualizarContrato(
  id: string,
  updates: ContratoUpdate,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const erro = validar(updates as Partial<CriarContratoInput>);
  if (erro) return { success: false, error: erro };

  // Estado atual do contrato: serve a guarda de transição (uma edição não deve
  // reabrir um contrato terminal nem saltar de/para pré-contrato) e a limpeza da
  // mota antiga se o veículo for trocado. Só lê quando o estado ou o veículo mudam.
  let atualVeiculo: string | null = null;
  if (updates.estado || updates.veiculo_id) {
    const { data: atual } = await supabaseAdmin
      .from("contrato_aluguer")
      .select("estado, veiculo_id")
      .eq("id", id)
      .maybeSingle();
    atualVeiculo = atual?.veiculo_id ?? null;
    const de = atual?.estado;
    if (updates.estado && de && de !== updates.estado) {
      if (de === "concluido" || de === "cancelado") {
        return { success: false, error: "Contrato terminado — não pode ser reaberto por edição." };
      }
      if (de === "pre_contrato") {
        return { success: false, error: "Pré-contrato: usa Finalizar ou Descartar, não a edição de estado." };
      }
    }
  }

  const { error } = await supabaseAdmin
    .from("contrato_aluguer")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("atualizarContrato error:", error);
    return { success: false, error: "Erro ao atualizar contrato." };
  }

  // Ao concluir/cancelar liberta o veículo; ao (re)ativar ocupa-o. Os helpers
  // mantêm o catálogo do site em sincronia (disponivel<->alugada).
  if (updates.estado && updates.veiculo_id) {
    if (updates.estado === "concluido" || updates.estado === "cancelado") {
      await libertarMota(updates.veiculo_id);
    } else if (updates.estado === "ativo") {
      await ocuparMota(updates.veiculo_id);
    }
  }
  // Se o veículo do contrato foi TROCADO, liberta a mota antiga do catálogo/operação
  // (senão ficaria presa como 'ocupado'/'alugada' e apareceria como fantasma no site).
  if (updates.veiculo_id && atualVeiculo && atualVeiculo !== updates.veiculo_id) {
    await libertarMota(atualVeiculo);
  }
  // A COBRANÇA SEGUE O CONTRATO: reconcilia as rendas por pagar com a mota atual.
  if (updates.veiculo_id) {
    await reconciliarCobrancasComContrato(id);
  }

  // Ativar por edição também promove o motorista lead→ativo (como criarContrato
  // e a vistoria de entrega). O motorista_id lê-se do contrato se não vier.
  if (updates.estado === "ativo") {
    const { data: c } = await supabaseAdmin
      .from("contrato_aluguer")
      .select("motorista_id")
      .eq("id", id)
      .maybeSingle();
    if (c?.motorista_id) {
      await supabaseAdmin
        .from("motorista")
        .update({ estado: "ativo" })
        .eq("id", c.motorista_id)
        .eq("estado", "lead");
    }
  }

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/motas");
  revalidatePath("/admin/cobrancas");
  return { success: true };
}

/**
 * Termina um contrato: marca-o como concluído na data de fim, ANULA as cobranças
 * futuras ainda por pagar (semanas que já não vão ser usadas — o modelo é
 * pré-pago) e liberta o veículo. As semanas já iniciadas/pagas mantêm-se (dívida
 * real). É o "evento de fim" que trava a geração rolante.
 */
export async function terminarContrato(
  id: string,
  dataFim: string,
): Promise<{ success: boolean; anuladas?: number; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!dataFim) return { success: false, error: "Indica a data de fim do contrato." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
    return { success: false, error: "Data inválida (usa AAAA-MM-DD)." };
  }

  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("veiculo_id")
    .eq("id", id)
    .maybeSingle();

  // 1.º concluir: fecha já a janela de geração rolante (fn_gerar_cobrancas só
  // gera para ativo/pendente_fecho), evitando corridas com o cron. A guarda de
  // estado torna a ação idempotente e impede concluir um pré-contrato/rascunho
  // (nunca entregue) ou re-concluir (reescrevendo data_fim).
  const { data: terminado, error } = await supabaseAdmin
    .from("contrato_aluguer")
    .update({ estado: "concluido", data_fim: dataFim })
    .eq("id", id)
    .in("estado", ["ativo", "pendente_fecho", "suspenso"])
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("terminarContrato error:", error);
    return { success: false, error: "Erro ao terminar o contrato." };
  }
  if (!terminado) return { success: false, error: "Só um contrato aberto (ativo/pendente/suspenso) pode ser terminado." };

  // 2.º anular as semanas FUTURAS por liquidar (início depois do fim). As já
  // pagas/parciais mantêm-se (dinheiro real ou dívida por uma semana usada).
  const { data: anuladasData, error: anulErr } = await supabaseAdmin
    .from("cobranca")
    .update({ estado_liquidacao: "anulada" })
    .eq("contrato_id", id)
    .eq("estado_liquidacao", "por_liquidar")
    .gt("periodo_inicio", dataFim)
    .select("id");
  if (anulErr) {
    console.error("terminarContrato anular error:", anulErr);
    // O contrato já ficou concluído (não gera mais); as cobranças futuras
    // podem ser anuladas manualmente. Não revertemos.
  }

  if (c?.veiculo_id) {
    await libertarMota(c.veiculo_id);
  }

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/motas");
  revalidatePath("/admin/cobrancas");
  return { success: true, anuladas: anuladasData?.length ?? 0 };
}

/**
 * Inicia (ou estende) a faturação de um contrato: fixa a âncora do 1.º
 * vencimento, se ainda não existir, e materializa as cobranças até `ate`.
 */
export async function gerarCobrancas(
  contratoId: string,
  ate: string,
  ancora?: string,
): Promise<{ success: boolean; geradas?: number; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (ancora) {
    const { error } = await supabaseAdmin
      .from("contrato_aluguer")
      .update({ ancora_vencimento: ancora })
      .eq("id", contratoId);
    if (error) {
      console.error("gerarCobrancas anchor error:", error);
      return { success: false, error: "Erro ao fixar a data de início da faturação." };
    }
  }

  const { data, error } = await supabaseAdmin.rpc("fn_gerar_cobrancas", {
    p_contrato_id: contratoId,
    p_ate: ate,
  });

  if (error) {
    console.error("gerarCobrancas rpc error:", error);
    return { success: false, error: "Erro ao gerar as cobranças." };
  }

  // Alinha as cobranças por pagar com a mota atual do contrato (caso tenha sido
  // trocada depois de já existirem cobranças).
  await reconciliarCobrancasComContrato(contratoId);

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/cobrancas");
  return { success: true, geradas: data ?? 0 };
}
