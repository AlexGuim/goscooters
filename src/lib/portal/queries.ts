import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { calcularHistoricoAtivo, type HistoricoAtivo } from "@/lib/ativoHistorico";
import { ehNomePlaceholder } from "@/lib/nomeMotorista";
import type { Acerto, AcertoLinha, DespesaCategoria, EstadoPagamentoDespesa } from "@/types/db";

/** Linha do acerto + o documento (fatura/portagem/coima/seguro) da despesa de origem. */
export type AcertoLinhaComDoc = AcertoLinha & { documento_url: string | null };

/** Uma despesa como o parceiro a vê (só campos não-sensíveis; sem coima/pontos). */
export type DespesaPortal = {
  id: string;
  categoria: DespesaCategoria;
  descricao: string | null;
  data_despesa: string;
  valor_total: string;
  estado_pagamento: EstadoPagamentoDespesa;
  fornecedor: string | null;
  documento_url: string | null;
};

/** Uma despesa do parceiro com a matrícula da moto (para a lista de todas as motos). */
export type DespesaParceiro = DespesaPortal & { matricula: string | null };

/** O motorista que está com a moto agora (só o essencial, por privacidade). */
export type MotoristaAtual = { primeiroNome: string; desde: string | null };

/** Uma linha do financeiro consolidado do parceiro (por moto). */
export type FinanceiroMoto = {
  moto_id: string;
  matricula: string | null;
  modelo: string;
  receita: number;
  custo: number;
  resultado: number;
};

export type FinanceiroParceiro = {
  receita: number;
  custo: number;
  resultado: number;
  despesas_por_pagar: number;
  n_despesas_por_pagar: number;
  motos: FinanceiroMoto[];
};

/**
 * Leituras do portal, SEMPRE limitadas ao proprietário da sessão. O
 * `proprietarioId` vem do guard (requirePartner), nunca do URL. As leituras
 * por-id validam a posse na PRÓPRIA query (.eq proprietario_id) e devolvem null
 * — que a página traduz em 404 — quando o registo não é deste parceiro.
 */

export async function acertosDoParceiro(proprietarioId: string): Promise<Acerto[]> {
  const { data } = await supabaseAdmin
    .from("acerto")
    .select("*")
    .eq("proprietario_id", proprietarioId)
    .in("estado", ["fechado", "pago", "parcial"])
    .order("competencia_mes", { ascending: false });
  return data ?? [];
}

export async function acertoDoParceiro(
  proprietarioId: string,
  acertoId: string,
): Promise<{ acerto: Acerto; linhas: AcertoLinhaComDoc[] } | null> {
  // A posse é validada AQUI: só devolve se o acerto for deste parceiro.
  const { data: acerto } = await supabaseAdmin
    .from("acerto")
    .select("*")
    .eq("id", acertoId)
    .eq("proprietario_id", proprietarioId)
    .maybeSingle();
  if (!acerto) return null;

  // acerto_linha não tem proprietario_id — por isso só se leem DEPOIS de a posse
  // do acerto pai estar confirmada acima.
  const { data: linhas } = await supabaseAdmin
    .from("acerto_linha")
    .select("*")
    .eq("acerto_id", acertoId)
    .order("created_at");
  const base = linhas ?? [];

  // Anexa o documento de cada linha de despesa (fatura/portagem/coima/seguro) a
  // partir da despesa de origem. Os ids vêm SÓ deste acerto (já validado como
  // deste parceiro), por isso o parceiro só alcança documentos do seu fecho.
  const despesaIds = [
    ...new Set(base.filter((l) => l.despesa_id).map((l) => l.despesa_id as string)),
  ];
  const docPorDespesa = new Map<string, string | null>();
  if (despesaIds.length > 0) {
    const { data: despesas } = await supabaseAdmin
      .from("despesa")
      .select("id, detalhe")
      .in("id", despesaIds);
    for (const d of despesas ?? []) {
      const url = (d.detalhe as { documento_url?: string } | null)?.documento_url ?? null;
      docPorDespesa.set(d.id, url);
    }
  }

  const comDoc: AcertoLinhaComDoc[] = base.map((l) => ({
    ...l,
    documento_url: l.despesa_id ? docPorDespesa.get(l.despesa_id) ?? null : null,
  }));

  return { acerto, linhas: comDoc };
}

export async function historicoAtivoDoParceiro(
  proprietarioId: string,
  motoId: string,
): Promise<HistoricoAtivo | null> {
  // Posse validada antes de calcular: a moto tem de ser deste parceiro.
  const { data: moto } = await supabaseAdmin
    .from("moto")
    .select("id")
    .eq("id", motoId)
    .eq("proprietario_id", proprietarioId)
    .maybeSingle();
  if (!moto) return null;
  // O "Custos" do parceiro conta só o que ELE suporta (imputar_a='proprietario'),
  // batendo certo com os Acertos. A comissão da GoScooters entra só no fecho.
  return calcularHistoricoAtivo(motoId, { imputarA: ["proprietario"] });
}

/**
 * O motorista atual de cada moto, DERIVADO dos contratos em curso (mesma regra
 * do dashboard: estado ativo/pendente_fecho). Devolve só o primeiro nome + a
 * data de início — nunca apelido, telefone, NIF ou nº de contrato (minimização
 * de dados). Os ids vêm sempre de motos já filtradas por proprietario_id; ainda
 * assim reconfirmamos a posse antes de ler os contratos (defesa em profundidade).
 */
export async function motoristaAtualDasMotos(
  proprietarioId: string,
  motoIds: string[],
): Promise<Map<string, MotoristaAtual>> {
  const out = new Map<string, MotoristaAtual>();
  if (motoIds.length === 0) return out;

  const { data: motosDoDono } = await supabaseAdmin
    .from("moto")
    .select("id")
    .eq("proprietario_id", proprietarioId)
    .in("id", motoIds);
  const idsValidos = (motosDoDono ?? []).map((m) => m.id as string);
  if (idsValidos.length === 0) return out;

  const { data: cts } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("veiculo_id, motorista_id, data_inicio")
    .in("veiculo_id", idsValidos)
    .in("estado", ["ativo", "pendente_fecho"])
    .order("data_inicio", { ascending: false });

  const contratos = cts ?? [];
  const motoristaIds = [
    ...new Set(contratos.filter((c) => c.motorista_id).map((c) => c.motorista_id as string)),
  ];
  const nomePorMotorista = new Map<string, string>();
  if (motoristaIds.length > 0) {
    const { data: mots } = await supabaseAdmin
      .from("motorista")
      .select("id, nome")
      .in("id", motoristaIds);
    for (const m of mots ?? []) nomePorMotorista.set(m.id as string, (m.nome as string) ?? "");
  }

  for (const c of contratos) {
    const vid = c.veiculo_id as string;
    if (out.has(vid)) continue; // fica o contrato mais recente (ordenado desc)
    const nome = c.motorista_id ? nomePorMotorista.get(c.motorista_id) ?? "" : "";
    const primeiro = primeiroNomeSeguro(nome);
    if (!primeiro) continue;
    out.set(vid, { primeiroNome: primeiro, desde: (c.data_inicio as string) ?? null });
  }
  return out;
}

// "Motorista (por confirmar)" (placeholder de entrega ainda por completar) não é
// um nome — mostra-se como tal em vez de "Motorista".
function primeiroNomeSeguro(nome: string): string {
  if (ehNomePlaceholder(nome)) return nome.trim() ? "(por confirmar)" : "";
  return nome.trim().split(/\s+/)[0];
}

/**
 * As despesas de UMA moto que o PROPRIETÁRIO suporta (imputar_a='proprietario').
 * Valida a posse da moto (null → 404). Não expõe coimas/portagens do motorista
 * (imputar_a='motorista') nem custos da GoScooters, nem campos sensíveis
 * (data_infracao, pontos, cobranca_id).
 */
export async function despesasDaMotoDoParceiro(
  proprietarioId: string,
  motoId: string,
): Promise<DespesaPortal[] | null> {
  const { data: moto } = await supabaseAdmin
    .from("moto")
    .select("id")
    .eq("id", motoId)
    .eq("proprietario_id", proprietarioId)
    .maybeSingle();
  if (!moto) return null;

  const { data } = await supabaseAdmin
    .from("despesa")
    .select("id, categoria, descricao, data_despesa, valor_total, estado_pagamento, fornecedor, detalhe")
    .eq("veiculo_id", motoId)
    .eq("imputar_a", "proprietario")
    .order("data_despesa", { ascending: false });

  return (data ?? []).map((d) => ({
    id: d.id as string,
    categoria: d.categoria as DespesaCategoria,
    descricao: (d.descricao as string) ?? null,
    data_despesa: d.data_despesa as string,
    valor_total: d.valor_total as string,
    estado_pagamento: d.estado_pagamento as EstadoPagamentoDespesa,
    fornecedor: (d.fornecedor as string) ?? null,
    documento_url: (d.detalhe as { documento_url?: string } | null)?.documento_url ?? null,
  }));
}

/**
 * TODAS as despesas que o parceiro suporta (imputar_a='proprietario'), de todas
 * as suas motos, com a matrícula. Duplo guard (veiculo_id das motos do dono +
 * proprietario_id) porque a tabela despesa não tem posse implícita. Só campos
 * não-sensíveis; nunca coimas/portagens do motorista nem custos da GoScooters.
 */
export async function despesasDoParceiro(proprietarioId: string): Promise<DespesaParceiro[]> {
  const { data: motos } = await supabaseAdmin
    .from("moto")
    .select("id, matricula")
    .eq("proprietario_id", proprietarioId);
  const lista = motos ?? [];
  const ids = lista.map((m) => m.id as string);
  if (ids.length === 0) return [];
  const matDe = new Map(lista.map((m) => [m.id as string, (m.matricula as string) ?? null]));

  const { data } = await supabaseAdmin
    .from("despesa")
    .select("id, veiculo_id, categoria, descricao, data_despesa, valor_total, estado_pagamento, fornecedor, detalhe")
    .in("veiculo_id", ids)
    .eq("proprietario_id", proprietarioId)
    .eq("imputar_a", "proprietario")
    .order("data_despesa", { ascending: false });

  return (data ?? []).map((d) => ({
    id: d.id as string,
    categoria: d.categoria as DespesaCategoria,
    descricao: (d.descricao as string) ?? null,
    data_despesa: d.data_despesa as string,
    valor_total: d.valor_total as string,
    estado_pagamento: d.estado_pagamento as EstadoPagamentoDespesa,
    fornecedor: (d.fornecedor as string) ?? null,
    documento_url: (d.detalhe as { documento_url?: string } | null)?.documento_url ?? null,
    matricula: d.veiculo_id ? matDe.get(d.veiculo_id as string) ?? null : null,
  }));
}

/**
 * Financeiro consolidado do parceiro (todas as motos): reutiliza o MESMO
 * calcularHistoricoAtivo por moto (imputar_a='proprietario', sem duplicar
 * cálculo) e conta as despesas por pagar. O resultado EXCLUI a comissão da
 * GoScooters (essa entra só nos Acertos) — a UI diz isto explicitamente.
 */
export async function financeiroDoParceiro(proprietarioId: string): Promise<FinanceiroParceiro> {
  const { data: motos } = await supabaseAdmin
    .from("moto")
    .select("id, matricula, modelo")
    .eq("proprietario_id", proprietarioId)
    .order("matricula");
  const lista = motos ?? [];

  const historicos = await Promise.all(
    lista.map((m) => calcularHistoricoAtivo(m.id as string, { imputarA: ["proprietario"] })),
  );

  const porMoto: FinanceiroMoto[] = lista.map((m, i) => {
    const h = historicos[i];
    return {
      moto_id: m.id as string,
      matricula: (m.matricula as string) ?? null,
      modelo: m.modelo as string,
      receita: h?.receita ?? 0,
      custo: h?.custo ?? 0,
      resultado: h?.resultado ?? 0,
    };
  });

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const receita = r2(porMoto.reduce((s, m) => s + m.receita, 0));
  const custo = r2(porMoto.reduce((s, m) => s + m.custo, 0));

  // Despesas por pagar: duplo guard (veiculo_id das motos do dono + proprietario_id),
  // porque a tabela despesa não tem posse implícita.
  let despesasPorPagar = 0;
  let nPorPagar = 0;
  const ids = lista.map((m) => m.id as string);
  if (ids.length > 0) {
    const { data: pend } = await supabaseAdmin
      .from("despesa")
      .select("valor_total")
      .in("veiculo_id", ids)
      .eq("proprietario_id", proprietarioId)
      .eq("imputar_a", "proprietario")
      .in("estado_pagamento", ["pendente", "parcial"]);
    for (const d of pend ?? []) despesasPorPagar += Number(d.valor_total);
    nPorPagar = (pend ?? []).length;
  }

  return {
    receita,
    custo,
    resultado: r2(receita - custo),
    despesas_por_pagar: r2(despesasPorPagar),
    n_despesas_por_pagar: nPorPagar,
    motos: porMoto,
  };
}
