"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { notificar, resolverNotificacoes } from "@/lib/notificacoes";
import { ocuparMota, libertarMota } from "@/lib/motaEstado";
import { prontoParaEntrega, nifValidoPT } from "@/lib/kyc";
import { ehNomePlaceholder } from "@/lib/nomeMotorista";
import type { DocIdTipo, Database } from "@/types/db";

type MotoristaUpdate = Database["public"]["Tables"]["motorista"]["Update"];

export interface DanoPrevio {
  zona: string;
  nota: string;
  foto_path?: string | null;
}

/**
 * Item de material entregue com a mota (ex.: capacete, 2 chaves, colete).
 * Na entrega marca-se `entregue`; na recolha herda-se a lista e marca-se
 * `devolvido` por item. Guardado no jsonb vistoria.checklist.materiais.
 */
export interface MaterialLinha {
  key: string;
  rotulo: string;
  qtd: number;
  entregue?: boolean;
  devolvido?: boolean;
}

export interface SubmeterEntregaInput {
  contrato_id: string;
  km: number | null;
  nivel_combustivel: number | null; // 0..100
  video_path: string | null; // caminho no bucket privado
  foto_paths: string[]; // caminhos no bucket privado, por ordem dos slots
  assinatura_path: string | null;
  checklist_itens: Record<string, boolean>;
  danos: DanoPrevio[];
  materiais: MaterialLinha[];
  notas: string | null;
  // Prova de aceitação das regras (versão + hash da versão exata mostrada).
  regras_versao?: string | null;
  regras_hash?: string | null;
  regras_aceite?: boolean;
  // KYC do motorista capturado na própria entrega (opcional — se o motorista já os
  // tinha, não é preciso reenviar). doc_paths → motorista.doc_urls (ficheiros).
  nome?: string | null;
  nif?: string | null;
  doc_id_tipo?: string | null;
  doc_id_numero?: string | null;
  doc_id_validade?: string | null;
  doc_paths?: string[];
  carta_numero?: string | null;
  carta_categoria?: string | null;
  carta_pais?: string | null;
  carta_validade?: string | null;
  morada_linha1?: string | null;
  codigo_postal?: string | null;
  localidade?: string | null;
}

/**
 * Submete a vistoria de ENTREGA e ativa o contrato, numa só operação:
 * grava a vistoria (fotos/vídeo/assinatura como caminhos privados), regista a
 * KM, ativa o contrato (moto → ocupada), e promove o motorista lead → ativo.
 * O índice único vistoria(contrato_id,'entrega') garante que só há uma.
 */
export async function submeterVistoriaEntrega(
  input: SubmeterEntregaInput,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.contrato_id) return { success: false, error: "Contrato em falta." };

  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id, veiculo_id, motorista_id, estado")
    .eq("id", input.contrato_id)
    .maybeSingle();
  if (!c) return { success: false, error: "Contrato não encontrado." };
  // Não se entrega um pré-contrato: sem mota, a ativação violaria o invariante e
  // deixaria a vistoria órfã (o contrato nunca ficaria ativo).
  if (c.estado === "pre_contrato" || !c.veiculo_id) {
    return { success: false, error: "Contrato ainda sem mota atribuída — finaliza o pré-contrato primeiro." };
  }
  // Nem se reativa um contrato terminal por uma vistoria de entrega.
  if (c.estado === "concluido" || c.estado === "cancelado") {
    return { success: false, error: "Contrato terminado — não pode receber uma entrega." };
  }

  const { data: jaExiste } = await supabaseAdmin
    .from("vistoria")
    .select("id")
    .eq("contrato_id", input.contrato_id)
    .eq("tipo", "entrega")
    .maybeSingle();
  if (jaExiste) return { success: false, error: "Este contrato já tem uma vistoria de entrega." };

  // KYC na entrega: EXIGE o mínimo obrigatório (regra do Alex: não se finaliza sem
  // documento+ficheiro, NIF, carta e morada) e só depois grava. O gate corre ANTES
  // da gravação — assim uma entrega rejeitada não degrada dados já bons (ex.: um NIF
  // válido substituído por um typo). A carta vem do input (o cliente pré-preenche-a),
  // por isso o gate é tolerante à coluna carta_numero (fase4c) ainda não migrada.
  if (c.motorista_id) {
    const { data: atual } = await supabaseAdmin
      .from("motorista")
      .select("nif, nif_valido, doc_id_numero, doc_urls, morada_linha1")
      .eq("id", c.motorista_id)
      .maybeSingle();
    const novoNif = input.nif?.trim() ? input.nif.replace(/\D/g, "") : null;
    // Ficheiros novos JUNTAM-SE aos que a ficha tem AGORA — não aos que o
    // ecrã viu ao carregar. Entre um e outro o motorista pode ter enviado os
    // dele pelo link, ou o intake ter anexado os que o gestor fotografou.
    const docsAtuais = atual?.doc_urls ?? [];
    const docsNovos = (input.doc_paths ?? []).filter((p) => !docsAtuais.includes(p));
    const docUrls = docsNovos.length ? [...docsAtuais, ...docsNovos] : null;
    const merged = {
      nif: novoNif ?? atual?.nif,
      nif_valido: novoNif ? nifValidoPT(novoNif) : atual?.nif_valido ?? null,
      doc_id_numero: input.doc_id_numero?.trim() || atual?.doc_id_numero,
      doc_urls: docUrls ?? (docsAtuais.length ? docsAtuais : null),
      carta_numero: input.carta_numero?.trim() || null,
      morada_linha1: input.morada_linha1?.trim() || atual?.morada_linha1,
    };
    const { pronto, faltam } = prontoParaEntrega(merged);
    if (!pronto) {
      return { success: false, error: `Faltam dados obrigatórios do motorista para entregar: ${faltam.join(", ")}.` };
    }

    // Gate passou — grava o KYC.
    const upd: MotoristaUpdate = {};
    // Nome capturado na entrega: corrige o placeholder "Motorista (por confirmar)".
    if (input.nome?.trim() && !ehNomePlaceholder(input.nome)) upd.nome = input.nome.trim();
    if (novoNif) { upd.nif = novoNif; upd.nif_valido = nifValidoPT(novoNif); }
    if (input.doc_id_tipo) upd.doc_id_tipo = input.doc_id_tipo as DocIdTipo;
    if (input.doc_id_numero?.trim()) upd.doc_id_numero = input.doc_id_numero.trim();
    if (input.doc_id_validade) upd.doc_id_validade = input.doc_id_validade;
    if (docUrls) upd.doc_urls = docUrls;
    if (input.morada_linha1?.trim()) upd.morada_linha1 = input.morada_linha1.trim();
    if (input.codigo_postal?.trim()) upd.codigo_postal = input.codigo_postal.trim();
    if (input.localidade?.trim()) upd.localidade = input.localidade.trim();
    if (Object.keys(upd).length) await supabaseAdmin.from("motorista").update(upd).eq("id", c.motorista_id);

    // Carta em colunas recentes (fase4c) — tolerante se ainda não migradas.
    const cartaUpd: MotoristaUpdate = {};
    if (input.carta_numero?.trim()) cartaUpd.carta_numero = input.carta_numero.trim();
    if (input.carta_categoria?.trim()) cartaUpd.carta_categoria = input.carta_categoria.trim().toUpperCase();
    if (input.carta_pais?.trim()) cartaUpd.carta_pais = input.carta_pais.trim().toUpperCase();
    if (input.carta_validade) cartaUpd.carta_validade = input.carta_validade;
    if (Object.keys(cartaUpd).length) {
      const { error } = await supabaseAdmin.from("motorista").update(cartaUpd).eq("id", c.motorista_id);
      if (error) console.warn("entrega carta (migrar fase4c?):", error.message);
    }
  }

  const agora = new Date().toISOString();

  const { error: vErr } = await supabaseAdmin.from("vistoria").insert({
    contrato_id: input.contrato_id,
    tipo: "entrega",
    realizada_em: agora,
    km: input.km,
    nivel_combustivel: input.nivel_combustivel,
    // Guardamos o CAMINHO privado (não um URL público) — lê-se por URL assinado.
    video_url: input.video_path,
    foto_urls: input.foto_paths.length ? input.foto_paths : null,
    checklist: {
      itens: input.checklist_itens,
      danos: input.danos,
      materiais: input.materiais ?? [],
      regras: input.regras_versao
        ? {
            versao: input.regras_versao,
            hash: input.regras_hash ?? null,
            aceite: !!input.regras_aceite,
            em: agora,
          }
        : null,
    },
    notas: input.notas?.trim() || null,
    assinatura_cliente_url: input.assinatura_path,
  });
  if (vErr) {
    console.error("submeterVistoriaEntrega vistoria error:", vErr);
    return { success: false, error: "Erro ao gravar a vistoria." };
  }

  if (input.km != null && c.veiculo_id) {
    await supabaseAdmin.from("km_registo").insert({
      veiculo_id: c.veiculo_id,
      km: input.km,
      data: agora.slice(0, 10),
      fonte: "entrega",
    });
  }

  const upd: { estado: "ativo"; km_inicio?: number } = { estado: "ativo" };
  if (input.km != null) upd.km_inicio = input.km;
  const { error: ativErr } = await supabaseAdmin
    .from("contrato_aluguer")
    .update(upd)
    .eq("id", input.contrato_id);
  if (ativErr) {
    console.error("submeterVistoriaEntrega ativar error:", ativErr);
    return { success: false, error: "Erro ao ativar o contrato." };
  }

  if (c.veiculo_id) {
    await ocuparMota(c.veiculo_id);
  }
  // As notificações que pediam ESTA entrega já não têm nada para abrir: a
  // página de entrega de um contrato ativo só diz "já tem vistoria".
  await resolverNotificacoes(["contrato_pronto", "entrega_preparada"], input.contrato_id);
  // E o link de entrega que ainda estivesse por usar deixa de fazer sentido —
  // concluído depois disto, só produzia uma notificação "fazer entrega" para
  // uma entrega já feita, e continuava a aceitar documentos e assinatura.
  const { error: sessErr } = await supabaseAdmin
    .from("entrega_sessao")
    .update({ estado: "cancelado" })
    .eq("contrato_id", input.contrato_id)
    .in("estado", ["enviado", "aberto", "docs_carregados"]);
  if (sessErr) console.error("submeterVistoriaEntrega cancelar sessões:", sessErr);
  if (c.motorista_id) {
    // Promove só se ainda for lead — não mexe num já ativo/bloqueado.
    await supabaseAdmin
      .from("motorista")
      .update({ estado: "ativo" })
      .eq("id", c.motorista_id)
      .eq("estado", "lead");
  }

  // Regra do negócio: o DIA DA ENTREGA é o dia do 1.º pagamento. A entrega FIXA a
  // âncora de faturação na data de hoje (se ainda não estava fixada), alinha a
  // caução ao mesmo dia, e materializa a 1.ª cobrança (vencimento = hoje) para
  // poder ser cobrada logo na entrega.
  const hojeData = agora.slice(0, 10);
  const { data: cAtual } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("ancora_vencimento")
    .eq("id", input.contrato_id)
    .maybeSingle();
  if (!cAtual?.ancora_vencimento) {
    await supabaseAdmin
      .from("contrato_aluguer")
      .update({ ancora_vencimento: hojeData })
      .eq("id", input.contrato_id);
    // Caução (se houver, por liquidar) passa a vencer no dia da entrega.
    await supabaseAdmin
      .from("cobranca")
      .update({ data_vencimento: hojeData, periodo_inicio: hojeData, periodo_fim: hojeData })
      .eq("contrato_id", input.contrato_id)
      .eq("tipo", "caucao")
      .eq("estado_liquidacao", "por_liquidar");
  }
  // Gera a(s) renda(s) até hoje — a 1.ª semana vence no dia da entrega.
  await supabaseAdmin.rpc("fn_gerar_cobrancas", { p_contrato_id: input.contrato_id, p_ate: hojeData });

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/motas");
  revalidatePath("/admin/cobrancas");
  return { success: true };
}

/**
 * Regista um dano NOVO na devolução como despesa imputada ao motorista — é o
 * valor que sai da caução. Fica ligado ao contrato/veículo/motorista.
 */
export async function registarDanoRecolha(
  contratoId: string,
  valor: string,
  descricao: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  const valorNorm = valor.replace(",", ".").trim();
  const n = Number(valorNorm);
  if (!Number.isFinite(n) || n <= 0) return { success: false, error: "Indica um valor válido." };
  if (!descricao.trim()) return { success: false, error: "Descreve o dano." };

  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("veiculo_id, motorista_id")
    .eq("id", contratoId)
    .maybeSingle();
  if (!c) return { success: false, error: "Contrato não encontrado." };

  const { error } = await supabaseAdmin.from("despesa").insert({
    veiculo_id: c.veiculo_id,
    motorista_id: c.motorista_id,
    contrato_id: contratoId,
    categoria: "outro",
    descricao: `Dano na devolução: ${descricao.trim()}`,
    valor: valorNorm,
    data_despesa: new Date().toISOString().slice(0, 10),
    imputar_a: "motorista",
    estado_pagamento: "pendente",
  });
  if (error) {
    console.error("registarDanoRecolha error:", error);
    return { success: false, error: "Erro ao registar o dano." };
  }

  await notificar({
    tipo: "dano_recolha",
    titulo: "Dano na recolha — deduzir da caução",
    detalhe: descricao.trim(),
    href: `/admin/contratos/${contratoId}/vistoria`,
    entidade: "contrato",
    entidade_id: contratoId,
  });

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/despesas");
  return { success: true };
}

export interface SubmeterRecolhaInput {
  contrato_id: string;
  km: number | null;
  nivel_combustivel: number | null;
  video_path: string | null;
  foto_paths: string[];
  assinatura_path: string | null;
  checklist_itens: Record<string, boolean>;
  danos: DanoPrevio[];
  materiais: MaterialLinha[];
  notas: string | null;
}

/**
 * Submete a vistoria de RECOLHA e conclui o contrato: grava a vistoria de
 * recolha, regista a KM final, e termina o contrato (moto → disponível), anulando
 * as semanas futuras por liquidar. A comparação com a entrega faz-se no ecrã de
 * vistoria (URLs assinados das duas linhas).
 */
export async function submeterVistoriaRecolha(
  input: SubmeterRecolhaInput,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.contrato_id) return { success: false, error: "Contrato em falta." };

  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id, veiculo_id, estado")
    .eq("id", input.contrato_id)
    .maybeSingle();
  if (!c) return { success: false, error: "Contrato não encontrado." };
  // Só se recolhe um contrato que esteve entregue (aberto). Recolher um rascunho/
  // pré-contrato (nunca entregue) ou um já terminado não faz sentido.
  if (!["ativo", "pendente_fecho", "suspenso"].includes(c.estado)) {
    return { success: false, error: "Só um contrato aberto (ativo/pendente/suspenso) pode ser recolhido." };
  }

  const { data: ja } = await supabaseAdmin
    .from("vistoria")
    .select("id")
    .eq("contrato_id", input.contrato_id)
    .eq("tipo", "recolha")
    .maybeSingle();
  if (ja) return { success: false, error: "Este contrato já tem uma vistoria de recolha." };

  const agora = new Date().toISOString();

  const { error: vErr } = await supabaseAdmin.from("vistoria").insert({
    contrato_id: input.contrato_id,
    tipo: "recolha",
    realizada_em: agora,
    km: input.km,
    nivel_combustivel: input.nivel_combustivel,
    video_url: input.video_path,
    foto_urls: input.foto_paths.length ? input.foto_paths : null,
    checklist: { itens: input.checklist_itens, danos: input.danos, materiais: input.materiais ?? [] },
    notas: input.notas?.trim() || null,
    assinatura_cliente_url: input.assinatura_path,
  });
  if (vErr) {
    console.error("submeterVistoriaRecolha error:", vErr);
    return { success: false, error: "Erro ao gravar a vistoria de recolha." };
  }

  if (input.km != null && c.veiculo_id) {
    await supabaseAdmin.from("km_registo").insert({
      veiculo_id: c.veiculo_id,
      km: input.km,
      data: agora.slice(0, 10),
      fonte: "recolha",
    });
  }

  // Conclui o contrato (data de fim = hoje) e liberta o veículo.
  const upd: { estado: "concluido"; data_fim: string; km_fim?: number } = {
    estado: "concluido",
    data_fim: agora.slice(0, 10),
  };
  if (input.km != null) upd.km_fim = input.km;
  await supabaseAdmin.from("contrato_aluguer").update(upd).eq("id", input.contrato_id);

  await supabaseAdmin
    .from("cobranca")
    .update({ estado_liquidacao: "anulada" })
    .eq("contrato_id", input.contrato_id)
    .eq("estado_liquidacao", "por_liquidar")
    .gt("periodo_inicio", agora.slice(0, 10));

  if (c.veiculo_id) {
    await libertarMota(c.veiculo_id);
  }

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/motas");
  return { success: true };
}
