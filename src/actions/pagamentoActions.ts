"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import type { PagamentoMetodo, PagamentoRecebidoPor } from "@/types/db";

export interface AlocacaoInput {
  cobranca_id: string;
  valor_alocado: number;
}

export interface RegistarPagamentoInput {
  motorista_id: string;
  valor: number;
  data_recebimento: string;
  metodo?: PagamentoMetodo | null;
  referencia?: string | null;
  /** Quem recebeu: 'goscooters' (default) ou 'proprietario' (conta do parceiro). */
  recebido_por?: PagamentoRecebidoPor;
  alocacoes: AlocacaoInput[];
}

/**
 * Regista um pagamento e aloca-o às cobranças (semanas). Uma transferência pode
 * cobrir várias semanas — a alocação N:M é o que o resolve. Os gatilhos da BD
 * recalculam sozinhos o estado de cada cobrança abrangida.
 */
export async function registarPagamento(
  input: RegistarPagamentoInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!input.motorista_id) return { success: false, error: "Motorista em falta." };
  const total = Number(input.valor);
  if (!Number.isFinite(total) || total <= 0) {
    return { success: false, error: "Indica um valor válido." };
  }

  const alocacoes = (input.alocacoes ?? []).filter((a) => a.valor_alocado > 0);
  const soma = alocacoes.reduce((s, a) => s + a.valor_alocado, 0);
  // Pequena folga para arredondamentos.
  if (soma > total + 0.001) {
    return { success: false, error: "A soma das alocações excede o valor recebido." };
  }

  const { data: pag, error } = await supabaseAdmin
    .from("pagamento")
    .insert({
      motorista_id: input.motorista_id,
      valor: String(total),
      data_recebimento: input.data_recebimento,
      metodo: input.metodo ?? null,
      referencia: input.referencia?.trim() || null,
      // Só enviar recebido_por quando NÃO é o default, para o insert funcionar
      // mesmo antes da migração (coluna inexistente). Omisso → default da BD.
      ...(input.recebido_por && input.recebido_por !== "goscooters"
        ? { recebido_por: input.recebido_por }
        : {}),
    })
    .select("id")
    .single();

  if (error) {
    console.error("registarPagamento error:", error);
    return { success: false, error: "Erro ao gravar o pagamento." };
  }

  if (alocacoes.length > 0) {
    const { error: e2 } = await supabaseAdmin.from("pagamento_cobranca").insert(
      alocacoes.map((a) => ({
        pagamento_id: pag.id,
        cobranca_id: a.cobranca_id,
        valor_alocado: String(a.valor_alocado),
      })),
    );
    if (e2) {
      console.error("registarPagamento alocacao error:", e2);
      return { success: false, error: "Pagamento gravado, mas falhou a alocação às semanas." };
    }
  }

  revalidatePath("/admin/cobrancas");
  return { success: true, id: pag.id };
}

const dataCurta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * Um pagamento está "trancado" se alguma das suas cobranças já foi congelada num
 * acerto FECHADO/pago — corrigir/estornar aí divergiria do extrato emitido. Nesse
 * caso bloqueia-se (reabrir o acerto é um passo futuro à parte).
 */
async function pagamentoEmAcertoFechado(pagamentoId: string): Promise<boolean> {
  const { data: allocs } = await supabaseAdmin
    .from("pagamento_cobranca")
    .select("cobranca_id")
    .eq("pagamento_id", pagamentoId);
  const cobIds = (allocs ?? []).map((a) => a.cobranca_id).filter(Boolean) as string[];
  if (!cobIds.length) return false;
  // As acerto_linha só nascem no FECHO, por isso qualquer linha para estas
  // cobranças = já congeladas num acerto (cobre fechado/pago/parcial de uma vez).
  const { data: linhas } = await supabaseAdmin
    .from("acerto_linha")
    .select("cobranca_id")
    .in("cobranca_id", cobIds)
    .limit(1);
  return (linhas ?? []).length > 0;
}

export interface PagamentoLista {
  id: string;
  motorista_id: string;
  motorista_nome: string;
  valor: string;
  data_recebimento: string;
  recebido_por: PagamentoRecebidoPor;
  semanas: string[];
  bloqueado: boolean;
}

/** Livro de pagamentos recentes, para corrigir o recebedor ou estornar erros. */
export async function listarPagamentos(): Promise<PagamentoLista[]> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return [];

  // select("*") tolera a coluna recebido_por ainda não existir (pré-migração):
  // fica undefined e cai no default, em vez de a query falhar e esvaziar a lista.
  const { data: pags } = await supabaseAdmin
    .from("pagamento")
    .select("*")
    .order("data_recebimento", { ascending: false })
    .limit(200);
  if (!pags?.length) return [];

  const pagIds = pags.map((p) => p.id);
  const motIds = [...new Set(pags.map((p) => p.motorista_id).filter(Boolean) as string[])];
  const [{ data: mots }, { data: allocs }] = await Promise.all([
    supabaseAdmin.from("motorista").select("id, nome").in("id", motIds),
    supabaseAdmin.from("pagamento_cobranca").select("pagamento_id, cobranca_id").in("pagamento_id", pagIds),
  ]);
  const nomeDe = new Map((mots ?? []).map((m) => [m.id, m.nome]));

  const cobIds = [...new Set((allocs ?? []).map((a) => a.cobranca_id).filter(Boolean) as string[])];
  const [{ data: cobs }, { data: linhasAcerto }] = await Promise.all([
    cobIds.length
      ? supabaseAdmin.from("cobranca").select("id, periodo_inicio, periodo_fim, veiculo_id").in("id", cobIds)
      : Promise.resolve({ data: [] as { id: string; periodo_inicio: string; periodo_fim: string; veiculo_id: string }[] }),
    cobIds.length
      ? supabaseAdmin.from("acerto_linha").select("cobranca_id").in("cobranca_id", cobIds)
      : Promise.resolve({ data: [] as { cobranca_id: string }[] }),
  ]);
  const veicIds = [...new Set((cobs ?? []).map((c) => c.veiculo_id).filter(Boolean) as string[])];
  const { data: motos } = veicIds.length
    ? await supabaseAdmin.from("moto").select("id, matricula").in("id", veicIds)
    : { data: [] as { id: string; matricula: string | null }[] };
  const matDe = new Map((motos ?? []).map((m) => [m.id, m.matricula]));
  const cobInfo = new Map((cobs ?? []).map((c) => [c.id, c]));

  // Qualquer cobrança com acerto_linha já foi congelada (fechado/pago/parcial).
  const bloqueadas = new Set<string>((linhasAcerto ?? []).map((l) => l.cobranca_id as string));

  const semanasPorPag = new Map<string, string[]>();
  const bloqPorPag = new Map<string, boolean>();
  for (const a of allocs ?? []) {
    const c = cobInfo.get(a.cobranca_id as string);
    const label = c
      ? `${matDe.get(c.veiculo_id) ?? ""} ${dataCurta(c.periodo_inicio)}–${dataCurta(c.periodo_fim)}`.trim()
      : "";
    const arr = semanasPorPag.get(a.pagamento_id as string) ?? [];
    if (label) arr.push(label);
    semanasPorPag.set(a.pagamento_id as string, arr);
    if (bloqueadas.has(a.cobranca_id as string)) bloqPorPag.set(a.pagamento_id as string, true);
  }

  return pags.map((p) => ({
    id: p.id,
    motorista_id: p.motorista_id as string,
    motorista_nome: nomeDe.get(p.motorista_id as string) ?? "—",
    valor: String(p.valor),
    data_recebimento: p.data_recebimento as string,
    recebido_por: (p.recebido_por as PagamentoRecebidoPor) ?? "goscooters",
    semanas: semanasPorPag.get(p.id) ?? [],
    bloqueado: bloqPorPag.get(p.id) ?? false,
  }));
}

/** Corrige o recebedor de um pagamento (GoScooters ↔ parceiro). Não mexe em montantes. */
export async function alterarRecebidoPor(
  pagamentoId: string,
  recebido_por: PagamentoRecebidoPor,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (await pagamentoEmAcertoFechado(pagamentoId)) {
    return { success: false, error: "Pagamento já num acerto fechado — reabre o acerto antes de corrigir." };
  }
  const { error } = await supabaseAdmin.from("pagamento").update({ recebido_por }).eq("id", pagamentoId);
  if (error) {
    console.error("alterarRecebidoPor error:", error);
    return { success: false, error: "Erro ao alterar o recebedor." };
  }
  revalidatePath("/admin/cobrancas");
  revalidatePath("/admin/acertos");
  return { success: true };
}

/**
 * Estorna (anula) um pagamento registado por erro: apaga-o. As alocações caem por
 * cascata e o gatilho recalcula o valor_pago/estado de cada cobrança abrangida (que
 * volta a por_liquidar/parcial). Bloqueado se tocar num acerto já fechado.
 */
export async function estornarPagamento(
  pagamentoId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (await pagamentoEmAcertoFechado(pagamentoId)) {
    return { success: false, error: "Pagamento já num acerto fechado — reabre o acerto antes de estornar." };
  }
  const { error } = await supabaseAdmin.from("pagamento").delete().eq("id", pagamentoId);
  if (error) {
    console.error("estornarPagamento error:", error);
    return { success: false, error: "Erro ao estornar o pagamento." };
  }
  revalidatePath("/admin/cobrancas");
  revalidatePath("/admin/acertos");
  return { success: true };
}
