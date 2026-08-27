"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { assinarComprovativo } from "@/lib/reciboToken";
import { comprovativosAtivosDe, semTabela } from "@/lib/comprovativos";
import type { ComprovativoSemana } from "@/types/db";

/**
 * Comprovativo de pagamento ao motorista — documento de gestão EMITIDO.
 *
 * Cobre 1..N pagamentos do MESMO motorista: com um, é o comprovativo simples do
 * dia-a-dia; com vários, é o consolidado (ex.: o mês inteiro). O documento grava
 * um SNAPSHOT (nome, NIF, valores, semanas cobertas) porque depois de sair por
 * WhatsApp não pode mudar sozinho — e mudaria: corrigir o recebedor, o nome, ou
 * anular uma cobrança reescreveria um papel que já está na mão do motorista.
 *
 * Requer a migração sql/fase11_comprovativo_pagamento.sql. Sem ela, as ações
 * devolvem um erro explicativo e o resto do sistema funciona como hoje.
 */

/** A tabela ainda não existe (migração por correr) — erro legível em vez de críptico. */
const FALTA_MIGRACAO = "Falta correr a migração sql/fase11_comprovativo_pagamento.sql no Supabase.";

export interface ComprovativoPronto {
  id: string;
  numero: string;
  link: string;
  whatsapp: string | null;
}

async function origem(): Promise<string> {
  const h = await headers();
  return h.get("origin") ?? `https://${h.get("host") ?? "goscooters.vercel.app"}`;
}

/** Link público (token assinado) + mensagem de WhatsApp pronta a enviar. */
async function montarLink(
  id: string,
  numero: string,
  motoristaId: string | null,
): Promise<ComprovativoPronto> {
  const link = `${await origem()}/comprovativo/${assinarComprovativo(id)}`;

  let whatsapp: string | null = null;
  if (motoristaId) {
    const { data: m } = await supabaseAdmin
      .from("motorista")
      .select("nome, telefone_e164, idioma_preferido")
      .eq("id", motoristaId)
      .maybeSingle();
    if (m?.telefone_e164) {
      const num = m.telefone_e164.replace(/\D/g, "");
      const primeiro = (m.nome ?? "").split(" ")[0];
      // Mesmo critério do documento (ver `idioma` no insert): tudo o que não for
      // 'en' sai em português — senão um motorista 'fr' recebia mensagem inglesa
      // com um documento português.
      const texto =
        (m.idioma_preferido ?? "pt") === "en"
          ? `Hi ${primeiro}, here is your GoScooters payment confirmation (${numero}): ${link}`
          : `Olá ${primeiro}, aqui está o teu comprovativo de pagamento GoScooters (${numero}): ${link}`;
      whatsapp = `https://wa.me/${num}?text=${encodeURIComponent(texto)}`;
    }
  }
  return { id, numero, link, whatsapp };
}

/**
 * Emite um comprovativo para 1..N pagamentos. Recusa misturar motoristas (o
 * documento tem um só destinatário) e pagamentos já cobertos por um comprovativo
 * activo (senão haveria dois papéis para o mesmo dinheiro).
 */
export async function emitirComprovativo(
  pagamentoIds: string[],
): Promise<{ success: boolean; dados?: ComprovativoPronto; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const ids = [...new Set((pagamentoIds ?? []).filter(Boolean))];
  if (!ids.length) return { success: false, error: "Escolhe pelo menos um pagamento." };

  const { data: pags, error: ePags } = await supabaseAdmin
    .from("pagamento")
    .select("id, motorista_id, valor, data_recebimento, metodo, referencia")
    .in("id", ids);
  if (ePags) return { success: false, error: "Erro ao ler os pagamentos." };
  if (!pags?.length) return { success: false, error: "Pagamentos não encontrados." };
  if (pags.length !== ids.length) return { success: false, error: "Algum pagamento já não existe." };

  const motoristas = new Set(pags.map((p) => p.motorista_id));
  if (motoristas.size > 1) {
    return { success: false, error: "Só é possível juntar pagamentos do mesmo motorista." };
  }
  const motoristaId = pags[0].motorista_id as string;

  // Já emitido? Um pagamento só pode estar num comprovativo ACTIVO (não anulado).
  // FALHA FECHADO: se não se conseguir apurar, recusa-se — emitir um segundo
  // documento para o mesmo dinheiro é pior do que recusar a emissão.
  const jaEmitidos = await comprovativosAtivosDe(ids);
  if (!jaEmitidos.ok) {
    return {
      success: false,
      error: jaEmitidos.semTabela
        ? FALTA_MIGRACAO
        : "Não foi possível verificar comprovativos já emitidos. Tenta de novo.",
    };
  }
  if (jaEmitidos.mapa.size) {
    const nums = [...new Set([...jaEmitidos.mapa.values()].map((c) => c.numero))];
    return {
      success: false,
      error: `Já existe comprovativo para esse(s) pagamento(s): ${nums.join(", ")}. Anula-o antes de emitir outro.`,
    };
  }

  // Snapshot do destinatário e do idioma em que o documento sai.
  const { data: mot } = await supabaseAdmin
    .from("motorista")
    .select("nome, nif, idioma_preferido")
    .eq("id", motoristaId)
    .maybeSingle();

  // Semanas cobertas por cada pagamento, congeladas (matrícula incluída: a mota
  // pode mudar de dono ou sair da frota, o documento não pode mudar com isso).
  const { data: allocs, error: eAlloc } = await supabaseAdmin
    .from("pagamento_cobranca")
    .select("pagamento_id, cobranca_id, valor_alocado")
    .in("pagamento_id", ids);
  // O snapshot é congelado para sempre: se a leitura falhar, o documento nasceria
  // sem os períodos cobertos e ninguém daria por isso. Melhor não nascer.
  if (eAlloc) return { success: false, error: "Erro ao ler os períodos cobertos." };
  const cobIds = [...new Set((allocs ?? []).map((a) => a.cobranca_id).filter(Boolean) as string[])];
  const { data: cobs, error: eCobs } = cobIds.length
    ? await supabaseAdmin
        .from("cobranca")
        .select("id, periodo_inicio, periodo_fim, tipo, veiculo_id")
        .in("id", cobIds)
    : { data: [] as { id: string; periodo_inicio: string; periodo_fim: string; tipo: string; veiculo_id: string }[], error: null };
  if (eCobs) return { success: false, error: "Erro ao ler os períodos cobertos." };
  const veicIds = [...new Set((cobs ?? []).map((c) => c.veiculo_id).filter(Boolean) as string[])];
  const { data: motos, error: eMotos } = veicIds.length
    ? await supabaseAdmin.from("moto").select("id, matricula").in("id", veicIds)
    : { data: [] as { id: string; matricula: string | null }[], error: null };
  if (eMotos) return { success: false, error: "Erro ao ler as motos." };
  const matDe = new Map((motos ?? []).map((m) => [m.id, m.matricula]));
  const cobDe = new Map((cobs ?? []).map((c) => [c.id, c]));

  const semanasPorPag = new Map<string, ComprovativoSemana[]>();
  for (const a of allocs ?? []) {
    const c = cobDe.get(a.cobranca_id as string);
    if (!c) continue;
    const arr = semanasPorPag.get(a.pagamento_id as string) ?? [];
    arr.push({
      matricula: matDe.get(c.veiculo_id) ?? null,
      inicio: c.periodo_inicio,
      fim: c.periodo_fim,
      tipo: c.tipo ?? null,
      valor: String(a.valor_alocado),
    });
    semanasPorPag.set(a.pagamento_id as string, arr);
  }

  // O total é a soma do RECEBIDO (não do alocado): é o que o motorista entregou.
  const total = pags.reduce((s, p) => s + Number(p.valor), 0);

  const { data: cab, error: eCab } = await supabaseAdmin
    .from("comprovativo_pagamento")
    .insert({
      motorista_id: motoristaId,
      motorista_nome: mot?.nome ?? "—",
      motorista_nif: mot?.nif ?? null,
      valor_total: total.toFixed(2),
      idioma: (mot?.idioma_preferido ?? "pt") === "en" ? "en" : "pt",
      criado_por: auth.user.email ?? null,
    })
    .select("id, numero")
    .single();
  if (eCab || !cab) {
    if (semTabela(eCab)) return { success: false, error: FALTA_MIGRACAO };
    console.error("emitirComprovativo cabecalho error:", eCab);
    return { success: false, error: "Erro ao emitir o comprovativo." };
  }

  const { error: eItens } = await supabaseAdmin.from("comprovativo_pagamento_item").insert(
    pags
      .slice()
      .sort((a, b) => a.data_recebimento.localeCompare(b.data_recebimento))
      .map((p) => ({
        comprovativo_id: cab.id,
        pagamento_id: p.id,
        data_recebimento: p.data_recebimento,
        valor: String(p.valor),
        metodo: p.metodo ?? null,
        referencia: p.referencia ?? null,
        semanas: semanasPorPag.get(p.id) ?? [],
      })),
  );
  if (eItens) {
    // Cabeçalho sem itens seria um documento vazio — desfaz-se.
    await supabaseAdmin.from("comprovativo_pagamento").delete().eq("id", cab.id);
    console.error("emitirComprovativo itens error:", eItens);
    return { success: false, error: "Erro ao gravar as linhas do comprovativo." };
  }

  revalidatePath("/admin/cobrancas");
  return { success: true, dados: await montarLink(cab.id, cab.numero, motoristaId) };
}

/** Regenera o link de um comprovativo já emitido (reenviar ao motorista). */
export async function linkComprovativo(
  comprovativoId: string,
): Promise<{ success: boolean; dados?: ComprovativoPronto; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data, error } = await supabaseAdmin
    .from("comprovativo_pagamento")
    .select("id, numero, motorista_id, anulado_em")
    .eq("id", comprovativoId)
    .maybeSingle();
  if (error) {
    return { success: false, error: semTabela(error) ? FALTA_MIGRACAO : "Erro ao ler o comprovativo." };
  }
  if (!data) return { success: false, error: "Comprovativo não encontrado." };
  if (data.anulado_em) {
    return { success: false, error: `O comprovativo ${data.numero} está anulado — emite um novo.` };
  }

  return { success: true, dados: await montarLink(data.id, data.numero, data.motorista_id) };
}

/**
 * Anula um comprovativo (dados errados, ou o pagamento foi estornado). Não apaga:
 * o link continua a abrir e passa a mostrar "ANULADO" — um documento financeiro
 * que desaparece lê-se como prova apagada.
 */
export async function anularComprovativo(
  comprovativoId: string,
  motivo?: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data, error } = await supabaseAdmin
    .from("comprovativo_pagamento")
    .update({ anulado_em: new Date().toISOString(), anulado_motivo: motivo?.trim() || null })
    .eq("id", comprovativoId)
    .is("anulado_em", null)
    .select("id");
  if (error) {
    if (semTabela(error)) return { success: false, error: FALTA_MIGRACAO };
    console.error("anularComprovativo error:", error);
    return { success: false, error: "Erro ao anular o comprovativo." };
  }
  if (!data?.length) return { success: false, error: "Comprovativo não encontrado ou já anulado." };
  revalidatePath("/admin/cobrancas");
  return { success: true };
}
