"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { comprovativosAtivosDe } from "@/lib/comprovativos";
import { geminiConfigurado, lerComprovativoGemini, mimeDoCaminho, ultimoErroDaIA } from "@/lib/gemini";
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

  // Um pagamento é dinheiro que JÁ entrou — não pode ter data no futuro. Sem
  // esta guarda, um "09" escrito em vez de "08" atirava 220 € para o mês
  // seguinte e o resultado de dois meses ficava errado sem ninguém dar por isso.
  const hoje = new Date().toISOString().slice(0, 10);
  if (input.data_recebimento > hoje) {
    return { success: false, error: `A data do pagamento (${input.data_recebimento}) está no futuro. Um pagamento regista-se depois de o dinheiro entrar.` };
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
  matriculas: string[]; // motos abrangidas (para o filtro por moto)
  proprietarios: string[]; // parceiros abrangidos (para o filtro por parceiro)
  bloqueado: boolean;
  /** Comprovativo ACTIVO que cobre este pagamento (null = ainda não emitido). */
  comprovativo_id: string | null;
  comprovativo_numero: string | null;
}

/**
 * Comprovativos ACTIVOS que cobrem estes pagamentos — versão TOLERANTE, só para
 * a listagem: se falhar (migração fase11 por correr, rede), mostra-se a lista
 * sem as referências em vez de a esvaziar. O estorno usa a versão estrita.
 */
async function comprovativosAtivos(
  pagIds: string[],
): Promise<Map<string, { id: string; numero: string }>> {
  const r = await comprovativosAtivosDe(pagIds);
  return r.ok ? r.mapa : new Map();
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
    ? await supabaseAdmin.from("moto").select("id, matricula, proprietario_id").in("id", veicIds)
    : { data: [] as { id: string; matricula: string | null; proprietario_id: string | null }[] };
  const matDe = new Map((motos ?? []).map((m) => [m.id, m.matricula]));
  const propDeMoto = new Map((motos ?? []).map((m) => [m.id, m.proprietario_id]));
  const propIds = [...new Set((motos ?? []).map((m) => m.proprietario_id).filter(Boolean) as string[])];
  const { data: props } = propIds.length
    ? await supabaseAdmin.from("proprietario").select("id, nome").in("id", propIds)
    : { data: [] as { id: string; nome: string }[] };
  const nomeProp = new Map((props ?? []).map((p) => [p.id, p.nome]));
  const cobInfo = new Map((cobs ?? []).map((c) => [c.id, c]));

  // Qualquer cobrança com acerto_linha já foi congelada (fechado/pago/parcial).
  const bloqueadas = new Set<string>((linhasAcerto ?? []).map((l) => l.cobranca_id as string));

  const semanasPorPag = new Map<string, string[]>();
  const matPorPag = new Map<string, Set<string>>();
  const propPorPag = new Map<string, Set<string>>();
  const bloqPorPag = new Map<string, boolean>();
  for (const a of allocs ?? []) {
    const pid = a.pagamento_id as string;
    const c = cobInfo.get(a.cobranca_id as string);
    const mat = c ? matDe.get(c.veiculo_id) ?? null : null;
    const label = c ? `${mat ?? ""} ${dataCurta(c.periodo_inicio)}–${dataCurta(c.periodo_fim)}`.trim() : "";
    const arr = semanasPorPag.get(pid) ?? [];
    if (label) arr.push(label);
    semanasPorPag.set(pid, arr);
    if (mat) (matPorPag.get(pid) ?? matPorPag.set(pid, new Set()).get(pid)!).add(mat);
    const prop = c ? nomeProp.get(propDeMoto.get(c.veiculo_id) ?? "") : null;
    if (prop) (propPorPag.get(pid) ?? propPorPag.set(pid, new Set()).get(pid)!).add(prop);
    if (bloqueadas.has(a.cobranca_id as string)) bloqPorPag.set(pid, true);
  }

  const compDe = await comprovativosAtivos(pagIds);

  return pags.map((p) => ({
    id: p.id,
    motorista_id: p.motorista_id as string,
    motorista_nome: nomeDe.get(p.motorista_id as string) ?? "—",
    valor: String(p.valor),
    data_recebimento: p.data_recebimento as string,
    recebido_por: (p.recebido_por as PagamentoRecebidoPor) ?? "goscooters",
    semanas: semanasPorPag.get(p.id) ?? [],
    matriculas: [...(matPorPag.get(p.id) ?? [])],
    proprietarios: [...(propPorPag.get(p.id) ?? [])],
    bloqueado: bloqPorPag.get(p.id) ?? false,
    comprovativo_id: compDe.get(p.id)?.id ?? null,
    comprovativo_numero: compDe.get(p.id)?.numero ?? null,
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

  // Um comprovativo já enviado não pode continuar a certificar dinheiro que foi
  // devolvido. FALHA FECHADO: se não se conseguir apurar se existe, não se
  // estorna — apagar o pagamento deixando o documento vivo é irreversível
  // (o pagamento desaparece e o documento fica órfão, a certificar o nada).
  const activos = await comprovativosAtivosDe([pagamentoId]);
  if (!activos.ok) {
    return {
      success: false,
      error: activos.semTabela
        ? "Erro ao estornar o pagamento."
        : "Não foi possível verificar o comprovativo deste pagamento. Tenta de novo.",
    };
  }
  const comp = activos.mapa.get(pagamentoId);

  // Anula ANTES de apagar (o documento não desaparece: o link do motorista
  // continua a abrir e passa a mostrar "ANULADO"). Se o apagar falhar a seguir,
  // desfaz-se a anulação — senão ficava um documento anulado sem estorno feito.
  if (comp) {
    const { error: eAnular } = await supabaseAdmin
      .from("comprovativo_pagamento")
      .update({ anulado_em: new Date().toISOString(), anulado_motivo: "Pagamento estornado" })
      .eq("id", comp.id)
      .is("anulado_em", null);
    if (eAnular) {
      console.error("estornarPagamento anular error:", eAnular);
      return { success: false, error: `Não foi possível anular o comprovativo ${comp.numero} — estorno cancelado.` };
    }
  }

  const { error } = await supabaseAdmin.from("pagamento").delete().eq("id", pagamentoId);
  if (error) {
    if (comp) {
      await supabaseAdmin
        .from("comprovativo_pagamento")
        .update({ anulado_em: null, anulado_motivo: null })
        .eq("id", comp.id);
    }
    console.error("estornarPagamento error:", error);
    return { success: false, error: "Erro ao estornar o pagamento." };
  }
  revalidatePath("/admin/cobrancas");
  revalidatePath("/admin/acertos");
  return { success: true };
}

/**
 * Leitura de COMPROVATIVOS de pagamento (print do MB WAY, de homebanking, de
 * uma conversa de WhatsApp, foto de talão): a IA extrai valor, data e quem
 * pagou, e o servidor tenta identificar o motorista pelo nome.
 *
 * O objetivo é o gestor só ter de CONFIRMAR. Por isso nada se grava aqui — a
 * função devolve uma sugestão; quem decide é o formulário de pagamento.
 */
export interface ComprovativoLido {
  valor: string | null;
  data: string | null;
  metodo: PagamentoMetodo | null;
  pagador: string | null;
  /** Nome de quem RECEBEU, tal como aparece no comprovativo. */
  destinatario: string | null;
  /**
   * Quem ficou com o dinheiro, deduzido do beneficiário: se o nome bate com um
   * parceiro, foi ele que recebeu — e isso muda o acerto dele. Só sugestão.
   */
  recebido_por: PagamentoRecebidoPor;
  /** Parceiro reconhecido no beneficiário (null se foi para a GoScooters). */
  beneficiario_parceiro: { id: string; nome: string } | null;
  referencia: string | null;
  confianca: "alta" | "media" | "baixa" | null;
  notas: string | null;
  /** Motorista identificado pelo nome do pagador (null se não deu para decidir). */
  motorista: { id: string; nome: string } | null;
  /** Quando o nome bate em vários (ou em nenhum) — o gestor escolhe. */
  candidatos: { id: string; nome: string }[];
  aviso: string | null;
}

/** Compara nomes ignorando acentos, maiúsculas e espaços a mais. */
function normalizarNome(n: string): string {
  return n
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function lerComprovativoPagamento(
  path: string,
): Promise<{ success: boolean; dados?: ComprovativoLido; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!geminiConfigurado()) {
    return { success: false, error: "A leitura por IA (Gemini) não está configurada neste ambiente." };
  }

  const mime = mimeDoCaminho(path);
  if (!mime.startsWith("image/") && mime !== "application/pdf") {
    return { success: false, error: "Formato não suportado. Usa uma imagem (JPG/PNG) ou PDF." };
  }

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from("motas").download(path);
  if (dlErr || !blob) {
    console.error("lerComprovativoPagamento download error:", dlErr);
    return { success: false, error: "Não consegui abrir o ficheiro carregado." };
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  if (buf.byteLength > 18 * 1024 * 1024) {
    return { success: false, error: "Ficheiro demasiado grande para a IA (máx. ~18 MB)." };
  }

  const lido = await lerComprovativoGemini([{ mime, base64: buf.toString("base64") }]);
  if (!lido) {
    const motivo = ultimoErroDaIA();
    return { success: false, error: `Não consegui ler o comprovativo${motivo ? ` — ${motivo}` : ""}.` };
  }

  // Identificar o motorista pelo nome de quem pagou. Um print de conversa traz
  // muitas vezes só o primeiro nome, por isso aceita-se correspondência parcial
  // — mas quando dá em mais do que um, NÃO se escolhe: o gestor decide.
  let motorista: ComprovativoLido["motorista"] = null;
  let candidatos: { id: string; nome: string }[] = [];
  let aviso: string | null = null;

  if (lido.pagador) {
    const alvo = normalizarNome(lido.pagador);
    const { data: mots } = await supabaseAdmin.from("motorista").select("id, nome");
    const lista = (mots ?? []).map((m) => ({ id: m.id as string, nome: m.nome as string }));

    const exatos = lista.filter((m) => normalizarNome(m.nome) === alvo);
    const parciais = lista.filter((m) => {
      const n = normalizarNome(m.nome);
      return n !== alvo && (n.includes(alvo) || alvo.includes(n));
    });
    // Último recurso: bater em qualquer palavra do nome (primeiro/último nome).
    const porPalavra =
      exatos.length || parciais.length
        ? []
        : lista.filter((m) => {
            const partes = normalizarNome(m.nome).split(" ").filter((x) => x.length >= 3);
            return partes.some((x) => alvo.split(" ").includes(x));
          });

    const achados = exatos.length ? exatos : parciais.length ? parciais : porPalavra;
    if (achados.length === 1) {
      motorista = achados[0];
      if (!exatos.length) {
        aviso = `Li "${lido.pagador}" e associei a ${achados[0].nome} — confirma que é o mesmo.`;
      }
    } else if (achados.length > 1) {
      candidatos = achados.slice(0, 8);
      aviso = `"${lido.pagador}" corresponde a ${achados.length} motoristas — escolhe qual.`;
    } else {
      aviso = `Não encontrei nenhum motorista com o nome "${lido.pagador}".`;
    }
  } else {
    aviso = "Não consegui ler o nome de quem pagou — escolhe o motorista.";
  }

  // Quem RECEBEU. Um comprovativo que diz "Beneficiário: Felipe Zumba Amorim"
  // não é dinheiro que entrou na GoScooters — é renda que foi direto ao
  // parceiro, e tratá-la como nossa estraga o acerto dele.
  let beneficiarioParceiro: { id: string; nome: string } | null = null;
  if (lido.destinatario) {
    const alvo = normalizarNome(lido.destinatario);
    const { data: props } = await supabaseAdmin
      .from("proprietario")
      .select("id, nome, eh_goscooters");
    for (const p of props ?? []) {
      if (p.eh_goscooters) continue;
      const n = normalizarNome(p.nome as string);
      if (n === alvo || n.includes(alvo) || alvo.includes(n)) {
        beneficiarioParceiro = { id: p.id as string, nome: p.nome as string };
        break;
      }
    }
  }

  // Se o beneficiário não identificou ninguém, vale a regra do parceiro: há
  // donos que cobram sempre direto (proprietario.recebe_pagamento_direto), e
  // nesses a renda quase nunca passa pela GoScooters. É o mesmo default que o
  // formulário de Cobranças já usa — faltava aqui.
  let recebePorOmissao: PagamentoRecebidoPor = "goscooters";
  if (!beneficiarioParceiro && motorista) {
    const { data: ct } = await supabaseAdmin
      .from("contrato_aluguer")
      .select("veiculo_id")
      .eq("motorista_id", motorista.id)
      .in("estado", ["ativo", "pendente_fecho"])
      .order("data_inicio", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ct?.veiculo_id) {
      const { data: mo } = await supabaseAdmin
        .from("moto")
        .select("proprietario_id")
        .eq("id", ct.veiculo_id)
        .maybeSingle();
      if (mo?.proprietario_id) {
        const { data: dono } = await supabaseAdmin
          .from("proprietario")
          .select("recebe_pagamento_direto")
          .eq("id", mo.proprietario_id)
          .maybeSingle();
        if (dono?.recebe_pagamento_direto) recebePorOmissao = "proprietario";
      }
    }
  }

  const metodosValidos: PagamentoMetodo[] = ["transferencia", "mbway", "numerario", "multibanco", "outro"];
  return {
    success: true,
    dados: {
      valor: lido.valor,
      data: lido.data,
      metodo: lido.metodo && metodosValidos.includes(lido.metodo) ? lido.metodo : null,
      pagador: lido.pagador,
      destinatario: lido.destinatario,
      recebido_por: beneficiarioParceiro ? "proprietario" : recebePorOmissao,
      beneficiario_parceiro: beneficiarioParceiro,
      referencia: lido.referencia,
      confianca: lido.confianca,
      notas: lido.notas,
      motorista,
      candidatos,
      aviso,
    },
  };
}

/**
 * Regista um pagamento alocando-o AUTOMATICAMENTE às semanas mais antigas em
 * dívida (FIFO) — a mesma regra do formulário de Cobranças, mas no servidor.
 *
 * Existe para o ecrã de Documentos poder fechar o ciclo sozinho: lê-se o
 * comprovativo, escolhe-se o motorista, e o dinheiro cai nas semanas certas sem
 * o gestor ter de reabrir outro ecrã e repetir os dados.
 */
export async function registarPagamentoAuto(input: {
  motorista_id: string;
  valor: number;
  data_recebimento: string;
  metodo?: PagamentoMetodo | null;
  referencia?: string | null;
  /** Quem ficou com o dinheiro. Sem isto, um pagamento direto ao parceiro era
   *  registado como recebido pela GoScooters e o acerto dele saía errado. */
  recebido_por?: PagamentoRecebidoPor;
}): Promise<{ success: boolean; id?: string; alocadas?: number; sobra?: number; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const total = Number(input.valor);
  if (!input.motorista_id) return { success: false, error: "Motorista em falta." };
  if (!Number.isFinite(total) || total <= 0) return { success: false, error: "Indica um valor válido." };

  // Semanas em dívida deste motorista, da mais antiga para a mais recente.
  const { data: abertas, error: eLer } = await supabaseAdmin
    .from("vw_cobranca_estado")
    .select("id, em_falta, data_vencimento")
    .eq("motorista_id", input.motorista_id)
    .in("estado_liquidacao", ["por_liquidar", "parcial"])
    .order("data_vencimento", { ascending: true });
  if (eLer) {
    console.error("registarPagamentoAuto ler error:", eLer);
    return { success: false, error: "Erro ao ler as semanas em dívida." };
  }

  let resto = total;
  const alocacoes: AlocacaoInput[] = [];
  for (const c of abertas ?? []) {
    if (resto <= 0.001) break;
    const falta = Number(c.em_falta);
    if (falta <= 0) continue;
    const aloc = Math.round(Math.min(resto, falta) * 100) / 100;
    alocacoes.push({ cobranca_id: c.id as string, valor_alocado: aloc });
    resto = Math.round((resto - aloc) * 100) / 100;
  }

  const r = await registarPagamento({
    motorista_id: input.motorista_id,
    valor: total,
    data_recebimento: input.data_recebimento,
    metodo: input.metodo ?? null,
    referencia: input.referencia ?? null,
    recebido_por: input.recebido_por,
    alocacoes,
  });
  if (!r.success) return r;
  return { success: true, id: r.id, alocadas: alocacoes.length, sobra: resto };
}
