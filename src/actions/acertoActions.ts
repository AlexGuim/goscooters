"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { formatarPreco } from "@/lib/precos";
import { notificar } from "@/lib/notificacoes";
import { rotuloSemanaMes, mesDaSemana, semanasDoMes } from "@/lib/datas";
import type { ManutencaoNaSemana, SemanaEstado, SemanaMoto } from "@/types/db";
import { ehNomePlaceholder } from "@/lib/nomeMotorista";
import { assinarAcerto } from "@/lib/reciboToken";
import type { AcertoLinhaTipo } from "@/types/db";

/**
 * Acerto mensal por parceiro.
 *
 * Fórmula (a validar com o utilizador):
 *   Receita  = valor PAGO das cobranças dos veículos do parceiro cujo
 *              vencimento cai no mês.
 *   Comissão = por veículo, receita × comissão% (override do veículo, ou a %
 *              base do proprietário). Receita da GoScooters.
 *   Despesas = despesas imputadas ao PROPRIETÁRIO, no mês.
 *   Líquido  = Receita − Comissão − Despesas.
 *
 * `calcular` faz a pré-visualização (não grava). `fechar` congela em acerto_linha.
 */

export interface AcertoLinhaPreview {
  tipo: AcertoLinhaTipo;
  descricao: string;
  matricula: string | null;
  veiculo_id: string | null;
  cobranca_id: string | null;
  despesa_id: string | null;
  /** Fatura da despesa, para a linha ser clicável (só nas despesas). */
  documento_url: string | null;
  periodo_inicio: string | null; // só nas rendas — referência da semana
  valor: number; // receita + ; despesa/comissão −
}

/** Renda do mês que ficou POR PAGAR — informativa, NÃO entra nos totais do acerto. */
export interface PendentePreview {
  matricula: string | null;
  semana: string; // rótulo "Semana N de <mês>"
  motorista: string | null;
  valor: number; // em falta (devido − pago)
}

/** Ajuste manual (entra no líquido): + soma, − desconta. */
export interface AjustePreview {
  id: string;
  descricao: string;
  valor: number;
}

/** Semana dada como PERDA (incobrável): era devida, não vai ser paga. */
export interface PerdaPreview {
  matricula: string | null;
  semana: string;
  motorista: string | null;
  valor: number;
  motivo: string | null;
}

export interface AcertoPreview {
  proprietario_id: string;
  proprietario_nome: string;
  competencia_mes: string;
  periodo_inicio: string;
  periodo_fim: string;
  receita_total: number;
  /** Parte da receita efetivamente cobrada PELA GoScooters (0 se paga direto). */
  receita_goscooters: number;
  comissao_total: number;
  despesa_total: number;
  /** Renda paga direto na conta do parceiro (inverte o sentido do líquido). */
  pago_direto: boolean;
  /** Positivo = a transferir ao parceiro; negativo = o parceiro deve à GoScooters. */
  liquido: number;
  linhas: AcertoLinhaPreview[];
  /** Rendas do mês por pagar (visibilidade; fora dos totais). */
  pendentes: PendentePreview[];
  perdas: PerdaPreview[];
  /** Linha do tempo semanal por moto (todas as semanas do mês). */
  semanas: SemanaMoto[];
  /** Ajustes manuais deste mês (já incluídos no líquido e nas linhas). */
  ajustes: AjustePreview[];
}

function periodoDoMes(competencia: string): { inicio: string; fim: string } {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimo = new Date(ano, mes, 0).getDate();
  return {
    inicio: `${competencia}-01`,
    fim: `${competencia}-${String(ultimo).padStart(2, "0")}`,
  };
}

async function computar(
  proprietarioId: string,
  competencia: string,
  inicio: string,
  fim: string,
): Promise<{ ok: true; preview: AcertoPreview } | { ok: false; error: string }> {
  // Select amplo (*) para ser tolerante a colunas recentes ainda não migradas
  // (ex.: recebe_pagamento_direto) — assim o acerto não parte antes da SQL.
  const { data: dono } = await supabaseAdmin
    .from("proprietario")
    .select("*")
    .eq("id", proprietarioId)
    .maybeSingle();
  if (!dono) return { ok: false, error: "Proprietário não encontrado." };
  // A frota própria não se acerta a si mesma: não há terceiro a quem transferir
  // nem comissão a cobrar. Os seus custos controlam-se no Financeiro/Despesas.
  if (dono.eh_goscooters) {
    return {
      ok: false,
      error: "A GoScooters (frota própria) não gera acerto — vê o Financeiro/Despesas.",
    };
  }

  const { data: veiculos } = await supabaseAdmin
    .from("moto")
    .select("id, matricula, comissao_valor_override")
    .eq("proprietario_id", proprietarioId);

  const veicIds = (veiculos ?? []).map((v) => v.id);
  const taxaBase = Number(dono.comissao_valor ?? 0);
  const taxaDe = new Map(
    (veiculos ?? []).map((v) => [
      v.id,
      v.comissao_valor_override != null ? Number(v.comissao_valor_override) : taxaBase,
    ]),
  );
  const matDe = new Map((veiculos ?? []).map((v) => [v.id, v.matricula]));

  const linhas: AcertoLinhaPreview[] = [];
  const pendentes: PendentePreview[] = [];
  const perdas: PerdaPreview[] = [];
  const semanas: SemanaMoto[] = [];
  let receita = 0;
  let receitaGs = 0; // parte cobrada pela GoScooters (o resto foi direto ao parceiro)
  const comissaoPorVeiculo = new Map<string, number>();

  if (veicIds.length > 0) {
    const { data: cobs } = await supabaseAdmin
      .from("cobranca")
      .select("id, veiculo_id, motorista_id, valor_pago, valor_devido, desconto, desconto_motivo, estado_liquidacao, incobravel_motivo, periodo_inicio, periodo_fim, data_vencimento")
      .in("veiculo_id", veicIds)
      .eq("tipo", "renda") // só renda gera comissão; caução/extra são reembolso
      .gte("data_vencimento", inicio)
      .lte("data_vencimento", fim);

    // A que MÊS pertence cada semana decide-se pela sua quarta-feira (igual ao
    // rótulo em Cobranças), não pela janela de datas — que assumia o vencimento
    // ao domingo e cortava a 5.ª semana quando o vencimento calhava a meio da
    // semana (contratos que começam noutro dia). Assim o acerto nunca diverge da
    // lista de Cobranças.
    const doMes = (cobs ?? []).filter((c) => mesDaSemana(c.data_vencimento) === competencia);
    const pagas = doMes.filter((c) => Number(c.valor_pago) > 0);
    const cobIds = pagas.map((c) => c.id);

    // Quanto de cada renda foi recebido PELA GoScooters (o resto entrou na conta
    // do parceiro). Vem das alocações de pagamento, pelo recebido_por de cada um.
    const gsPorCobranca = new Map<string, number>();
    // Tolerância à migração: se a coluna recebido_por ainda não existir, trata-se
    // tudo como recebido pela GoScooters (comportamento anterior) em vez de partir.
    let semRecebidoPor = false;
    if (cobIds.length > 0) {
      const { data: alocs, error: alocErr } = await supabaseAdmin
        .from("pagamento_cobranca")
        .select("cobranca_id, valor_alocado, pagamento:pagamento_id(recebido_por)")
        .in("cobranca_id", cobIds);
      if (alocErr) {
        semRecebidoPor = true;
      } else {
        for (const a of alocs ?? []) {
          // O embed do pagamento pode vir como objeto ou array conforme a versão.
          const pj = Array.isArray(a.pagamento) ? a.pagamento[0] : a.pagamento;
          const rp = (pj as { recebido_por?: string } | null)?.recebido_por ?? "goscooters";
          if (rp === "goscooters") {
            const k = a.cobranca_id as string;
            gsPorCobranca.set(k, (gsPorCobranca.get(k) ?? 0) + Number(a.valor_alocado));
          }
        }
      }
    }

    // 1.º nome do motorista que pagou cada semana — ajuda o parceiro a saber quem
    // esteve com a moto (uma moto pode trocar de motorista no mês). Só o 1.º nome
    // (minimização RGPD, como no portal); o placeholder "por confirmar" não entra.
    const nomeMot = new Map<string, string>();
    const motIds = [...new Set(doMes.filter((c) => c.motorista_id).map((c) => c.motorista_id as string))];
    if (motIds.length > 0) {
      const { data: mots } = await supabaseAdmin.from("motorista").select("id, nome").in("id", motIds);
      for (const m of mots ?? []) {
        if (!ehNomePlaceholder(m.nome)) nomeMot.set(m.id as string, (m.nome as string).trim().split(/\s+/)[0]);
      }
    }

    // Ordena por veículo e por período. A semana mostra-se pelo rótulo real do mês
    // (rotuloSemanaMes: "Semana 5 de julho"), o MESMO que aparece em Cobranças —
    // não um contador sequencial. Assim os gaps ficam visíveis (uma moto com as
    // semanas 2, 4, 5 mostra-se assim, revelando a 1 e a 3 em falta).
    const pagasOrd = [...pagas].sort(
      (a, b) =>
        (a.veiculo_id ?? "").localeCompare(b.veiculo_id ?? "") ||
        a.periodo_inicio.localeCompare(b.periodo_inicio),
    );
    for (const c of pagasOrd) {
      const pago = Number(c.valor_pago);
      const gs = semRecebidoPor ? pago : Math.min(gsPorCobranca.get(c.id) ?? 0, pago);
      receita += pago;
      receitaGs += gs;
      const taxa = taxaDe.get(c.veiculo_id) ?? taxaBase;
      const com = Math.round(pago * taxa) / 100;
      comissaoPorVeiculo.set(
        c.veiculo_id,
        (comissaoPorVeiculo.get(c.veiculo_id) ?? 0) + com,
      );
      const canal = gs >= pago - 0.005 ? "GoScooters" : gs <= 0.005 ? "parceiro" : "misto";
      const nome = c.motorista_id ? nomeMot.get(c.motorista_id) : undefined;
      // Uma semana descontada entra com menos dinheiro do que o preço da moto.
      // Sem esta nota, o parceiro via 40 € onde esperava 55 € e não sabia porquê
      // — e a pergunta acabava por lhe chegar a ele, não ao extrato.
      const abatido = Number(c.desconto ?? 0);
      const notaDesc =
        abatido > 0
          ? ` · desconto ${formatarPreco(abatido)} de ${formatarPreco(c.valor_devido)}${
              c.desconto_motivo ? ` (${c.desconto_motivo})` : ""
            }`
          : "";
      linhas.push({
        tipo: "receita",
        descricao: `${rotuloSemanaMes(c.data_vencimento)}${nome ? ` · ${nome}` : ""} · recebido: ${canal}${notaDesc}`,
        matricula: matDe.get(c.veiculo_id) ?? null,
        veiculo_id: c.veiculo_id,
        cobranca_id: c.id,
        despesa_id: null,
        documento_url: null,
        periodo_inicio: c.periodo_inicio,
        valor: pago,
      });
    }

    // Rendas do mês que ficaram POR PAGAR (fora dos totais — só visibilidade, para
    // o parceiro ver o que não entrou por não ter sido pago). Exclui anuladas
    // (contrato acabou) e isentas; mostra o que falta (devido − pago).
    // Já não são cobráveis: anuladas (contrato acabou), isentas (perdoadas) e
    // incobráveis (perdidas — vão para a secção "Perdas", à parte). O desconto
    // abate ao devido: não se pede ao parceiro o que não se pediu ao motorista.
    const porPagar = doMes
      .filter((c) => {
        const est = c.estado_liquidacao as string | null;
        if (est === "anulada" || est === "isenta" || est === "incobravel") return false;
        return Number(c.valor_pago) < Number(c.valor_devido) - Number(c.desconto ?? 0);
      })
      .sort(
        (a, b) =>
          (a.veiculo_id ?? "").localeCompare(b.veiculo_id ?? "") ||
          a.periodo_inicio.localeCompare(b.periodo_inicio),
      );
    for (const c of porPagar) {
      pendentes.push({
        matricula: matDe.get(c.veiculo_id) ?? null,
        semana: rotuloSemanaMes(c.data_vencimento),
        motorista: c.motorista_id ? nomeMot.get(c.motorista_id) ?? null : null,
        valor:
          Math.round(
            (Number(c.valor_devido) - Number(c.desconto ?? 0) - Number(c.valor_pago)) * 100,
          ) / 100,
      });
    }

    // Manutenções do período, por moto — a partir das DESPESAS, não da tabela
    // `manutencao`. As duas divergem: a despesa tem a data em que o serviço foi
    // faturado (e é a que o parceiro paga e vê na lista de despesas); a tabela
    // de manutenção guarda a data do registo de oficina, que pode ser outra.
    // Um caso real: os mesmos 178 € apareciam a 19/08 na despesa e a 31/08 na
    // manutenção — e o marcador saltava para o mês seguinte, sumindo do extrato.
    // A despesa é também a única que garante fatura (27 de 27 têm documento).
    const janela = semanasDoMes(competencia);
    const manPorVeiculo = new Map<string, { data: string; valor: number; url: string | null; tipo: string | null }[]>();
    if (janela.length) {
      const [{ data: despMan }, { data: regMan }] = await Promise.all([
        supabaseAdmin
          .from("despesa")
          .select("id, veiculo_id, data_despesa, valor_total, detalhe")
          .in("veiculo_id", veicIds)
          .eq("categoria", "manutencao")
          .gte("data_despesa", janela[0].inicio)
          .lte("data_despesa", janela[janela.length - 1].fim),
        // Só para o rótulo ("óleo", "revisão"): o tipo vive no registo de oficina.
        supabaseAdmin.from("manutencao").select("tipo, despesa_id").in("veiculo_id", veicIds),
      ]);
      const tipoDe = new Map(
        (regMan ?? []).filter((r) => r.despesa_id).map((r) => [r.despesa_id as string, r.tipo as string]),
      );
      for (const d of despMan ?? []) {
        const arr = manPorVeiculo.get(d.veiculo_id as string) ?? [];
        arr.push({
          data: d.data_despesa as string,
          valor: Number(d.valor_total),
          url: (d.detalhe as { documento_url?: string } | null)?.documento_url ?? null,
          tipo: tipoDe.get(d.id) ?? null,
        });
        manPorVeiculo.set(d.veiculo_id as string, arr);
      }
    }
    const MAN_ROTULO: Record<string, string> = {
      revisao: "revisão", oleo: "óleo", pneu_frente: "pneu frente", pneu_tras: "pneu trás",
      pneus: "pneus", travoes: "travões", corrente: "corrente", inspecao: "inspeção", outro: "manutenção",
    };
    /** Intervenções desta moto nesta semana, com data, valor e fatura. */
    const manutencaoNa = (veiculoId: string, de: string, ate: string): ManutencaoNaSemana[] =>
      (manPorVeiculo.get(veiculoId) ?? [])
        .filter((x) => x.data >= de && x.data <= ate)
        .map((x) => ({
          rotulo: `${x.tipo ? MAN_ROTULO[x.tipo] ?? x.tipo : "manutenção"} ${x.data.slice(8, 10)}/${x.data.slice(5, 7)} · ${formatarPreco(x.valor)}`,
          documento_url: x.url,
        }));

    // ── LINHA DO TEMPO SEMANAL ────────────────────────────────────────────
    // Todas as semanas do mês, para TODAS as motos do parceiro — incluindo as
    // que não geraram receita nenhuma. Uma moto parada e uma moto com calote
    // pareciam iguais no extrato (ausência de linha); agora dizem-se pelo nome.
    // Exclui as anuladas: são de contratos cancelados e duplicariam a semana.
    const vivas = doMes.filter((c) => c.estado_liquidacao !== "anulada");
    for (const v of veiculos ?? []) {
      for (const sem of semanasDoMes(competencia)) {
        const naSemana = vivas.filter(
          (c) =>
            c.veiculo_id === v.id &&
            c.data_vencimento >= sem.inicio &&
            c.data_vencimento <= sem.fim,
        );
        if (naSemana.length === 0) {
          semanas.push({
            veiculo_id: v.id,
            matricula: v.matricula ?? null,
            rotulo: sem.rotulo,
            inicio: sem.inicio,
            fim: sem.fim,
            estado: "parada",
            valor: 0,
            recebido: null,
            devido: 0,
            desconto: 0,
            motorista: null,
            nota: null,
            manutencao: manutencaoNa(v.id, sem.inicio, sem.fim),
          });
          continue;
        }
        for (const c of naSemana) {
          const pago = Number(c.valor_pago);
          const abatido = Number(c.desconto ?? 0);
          const devido = Number(c.valor_devido);
          const est = c.estado_liquidacao as string;
          const estado: SemanaEstado =
            est === "incobravel"
              ? "perda"
              : est === "isenta"
                ? "isenta"
                : pago >= devido - abatido
                  ? "paga"
                  : pago > 0
                    ? "parcial"
                    : "por_cobrar";
          // Quem recebeu — o mesmo critério da linha de receita, para o extrato
          // não dizer uma coisa em cima e outra em baixo.
          const gsPago = semRecebidoPor ? pago : Math.min(gsPorCobranca.get(c.id) ?? 0, pago);
          const recebido: SemanaMoto["recebido"] =
            pago <= 0.005
              ? null
              : gsPago >= pago - 0.005
                ? "goscooters"
                : gsPago <= 0.005
                  ? "parceiro"
                  : "misto";
          semanas.push({
            veiculo_id: v.id,
            matricula: v.matricula ?? null,
            rotulo: rotuloSemanaMes(c.data_vencimento),
            inicio: c.periodo_inicio,
            fim: c.periodo_fim,
            estado,
            valor: pago,
            recebido,
            devido,
            desconto: abatido,
            motorista: c.motorista_id ? nomeMot.get(c.motorista_id) ?? null : null,
            nota:
              est === "incobravel"
                ? ((c.incobravel_motivo as string) ?? null)
                : abatido > 0
                  ? ((c.desconto_motivo as string) ?? null)
                  : null,
            manutencao: manutencaoNa(v.id, sem.inicio, sem.fim),
          });
        }
      }
    }
    semanas.sort(
      (a, b) =>
        (a.matricula ?? "").localeCompare(b.matricula ?? "") || a.inicio.localeCompare(b.inicio),
    );

    // Perdas do mês: semanas usadas e devidas que não vão ser pagas. Ficam FORA
    // dos totais (o acerto é a regime de caixa — nunca foram receita), mas o
    // parceiro tem de as ver, senão a receita desaparece sem explicação.
    for (const c of doMes.filter((x) => x.estado_liquidacao === "incobravel")) {
      const valor =
        Math.round(
          (Number(c.valor_devido) - Number(c.desconto ?? 0) - Number(c.valor_pago)) * 100,
        ) / 100;
      if (valor <= 0.005) continue;
      perdas.push({
        matricula: matDe.get(c.veiculo_id) ?? null,
        semana: rotuloSemanaMes(c.data_vencimento),
        motorista: c.motorista_id ? nomeMot.get(c.motorista_id) ?? null : null,
        valor,
        motivo: (c.incobravel_motivo as string) ?? null,
      });
    }
  }

  // Renda que foi direto ao parceiro (não à GoScooters): deduz-se, para o extrato
  // mostrar as rendas recebidas E o somatório bater certo com o líquido.
  const receitaParceiro = Math.round((receita - receitaGs) * 100) / 100;
  if (receitaParceiro > 0.005) {
    linhas.push({
      tipo: "receita",
      descricao: "Renda recebida diretamente pelo parceiro (fora da GoScooters)",
      matricula: null,
      veiculo_id: null,
      cobranca_id: null,
      despesa_id: null,
      documento_url: null,
      periodo_inicio: null,
      valor: -receitaParceiro,
    });
  }

  // Linhas de comissão (uma por veículo).
  let comissaoTotal = 0;
  for (const [veiculoId, com] of comissaoPorVeiculo) {
    const valor = Math.round(com * 100) / 100;
    comissaoTotal += valor;
    linhas.push({
      tipo: "comissao",
      descricao: `Comissão (${taxaDe.get(veiculoId) ?? taxaBase}%)`,
      matricula: matDe.get(veiculoId) ?? null,
      veiculo_id: veiculoId,
      cobranca_id: null,
      despesa_id: null,
      documento_url: null,
      periodo_inicio: null,
      valor: -valor,
    });
  }

  // Despesas imputadas ao proprietário. Ao contrário das rendas (semanas que
  // podem atravessar meses), uma despesa é um evento pontual: pertence ao seu
  // mês de calendário (a competência), não à janela De/Até das semanas.
  const mesDesp = periodoDoMes(competencia);
  let despesaTotal = 0;
  const { data: desps } = await supabaseAdmin
    .from("despesa")
    .select("id, veiculo_id, valor_total, categoria, descricao, detalhe")
    .eq("proprietario_id", proprietarioId)
    .eq("imputar_a", "proprietario")
    .gte("data_despesa", mesDesp.inicio)
    .lte("data_despesa", mesDesp.fim);

  for (const d of desps ?? []) {
    const v = Number(d.valor_total);
    despesaTotal += v;
    linhas.push({
      tipo: "despesa",
      descricao: `${d.categoria}${d.descricao ? ` · ${d.descricao}` : ""}`,
      matricula: d.veiculo_id ? matDe.get(d.veiculo_id) ?? null : null,
      veiculo_id: d.veiculo_id,
      cobranca_id: null,
      despesa_id: d.id,
      documento_url: (d.detalhe as { documento_url?: string } | null)?.documento_url ?? null,
      periodo_inicio: null,
      valor: -v,
    });
  }

  // Ajustes manuais deste mês (bónus/correção/dedução). Persistem em acerto_ajuste
  // por (proprietário, competência) e entram no líquido; ao fechar congelam como
  // linhas tipo 'ajuste'. Tolerante: sem a tabela (fase10 por correr) não há ajustes.
  const ajustes: AjustePreview[] = [];
  let ajusteTotal = 0;
  const { data: ajRows } = await supabaseAdmin
    .from("acerto_ajuste")
    .select("id, descricao, valor")
    .eq("proprietario_id", proprietarioId)
    .eq("competencia_mes", `${competencia}-01`)
    .order("created_at");
  for (const a of ajRows ?? []) {
    const v = Math.round(Number(a.valor) * 100) / 100;
    ajusteTotal += v;
    ajustes.push({ id: a.id, descricao: a.descricao, valor: v });
    linhas.push({
      tipo: "ajuste",
      descricao: a.descricao,
      matricula: null,
      veiculo_id: null,
      cobranca_id: null,
      despesa_id: null,
      documento_url: null,
      periodo_inicio: null,
      valor: v,
    });
  }
  ajusteTotal = Math.round(ajusteTotal * 100) / 100;

  const receitaTotal = Math.round(receita * 100) / 100;
  const receitaGoscooters = Math.round(receitaGs * 100) / 100;
  comissaoTotal = Math.round(comissaoTotal * 100) / 100;
  despesaTotal = Math.round(despesaTotal * 100) / 100;

  // Líquido = receita cobrada pela GoScooters − comissão − despesas. Se parte (ou
  // tudo) foi direto ao parceiro, o líquido desce e pode ficar negativo — nesse
  // caso é o que o parceiro DEVE à GoScooters. pago_direto = houve renda direta.
  const pagoDireto = receitaParceiro > 0.005;
  const liquido =
    Math.round((receitaGoscooters - comissaoTotal - despesaTotal + ajusteTotal) * 100) / 100;

  return {
    ok: true,
    preview: {
      proprietario_id: proprietarioId,
      proprietario_nome: dono.nome,
      competencia_mes: `${competencia}-01`,
      periodo_inicio: inicio,
      periodo_fim: fim,
      receita_total: receitaTotal,
      receita_goscooters: receitaGoscooters,
      comissao_total: comissaoTotal,
      despesa_total: despesaTotal,
      pago_direto: pagoDireto,
      liquido,
      linhas,
      pendentes,
      perdas,
      semanas,
      ajustes,
    },
  };
}

export async function calcularAcerto(
  proprietarioId: string,
  competencia: string,
  inicio?: string,
  fim?: string,
): Promise<{ success: boolean; preview?: AcertoPreview; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return { success: false, error: "Mês inválido (usa AAAA-MM)." };
  }
  const p = periodoDoMes(competencia);
  const de = inicio || p.inicio;
  const ate = fim || p.fim;

  const r = await computar(proprietarioId, competencia, de, ate);
  if (!r.ok) return { success: false, error: r.error };
  return { success: true, preview: r.preview };
}

export async function fecharAcerto(
  proprietarioId: string,
  competencia: string,
  inicio?: string,
  fim?: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  // Não fechar duas vezes o mesmo mês.
  const { data: existe } = await supabaseAdmin
    .from("acerto")
    .select("id")
    .eq("proprietario_id", proprietarioId)
    .eq("competencia_mes", `${competencia}-01`)
    .maybeSingle();
  if (existe) return { success: false, error: "Este mês já foi fechado para este parceiro." };

  const per = periodoDoMes(competencia);
  const r = await computar(proprietarioId, competencia, inicio || per.inicio, fim || per.fim);
  if (!r.ok) return { success: false, error: r.error };
  const p = r.preview;

  const { data: acerto, error } = await supabaseAdmin
    .from("acerto")
    .insert({
      proprietario_id: proprietarioId,
      competencia_mes: p.competencia_mes,
      periodo_inicio: p.periodo_inicio,
      periodo_fim: p.periodo_fim,
      receita_total: String(p.receita_total),
      receita_goscooters: String(p.receita_goscooters),
      despesa_total: String(p.despesa_total),
      comissao_total: String(p.comissao_total),
      pago_direto: p.pago_direto,
      liquido: String(p.liquido),
      // Contexto do mês, congelado: explica as semanas que não geraram receita.
      semanas: p.semanas,
      estado: "fechado",
      fechado_por: auth.user.email ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("fecharAcerto error:", error);
    return { success: false, error: "Erro ao fechar o acerto." };
  }

  if (p.linhas.length > 0) {
    const { error: e2 } = await supabaseAdmin.from("acerto_linha").insert([
      ...p.linhas.map((l) => ({
        acerto_id: acerto.id,
        tipo: l.tipo,
        cobranca_id: l.cobranca_id,
        despesa_id: l.despesa_id,
        veiculo_id: l.veiculo_id,
        matricula_snapshot: l.matricula,
        descricao: l.descricao,
        valor: String(l.valor),
      })),
      // Perdas: congeladas SÓ para o extrato explicar a receita que não veio.
      // Ficam fora de `p.linhas` de propósito — o líquido é calculado à parte e
      // não as pode apanhar por engano.
      ...p.perdas.map((x) => ({
        acerto_id: acerto.id,
        tipo: "perda" as const,
        cobranca_id: null,
        despesa_id: null,
        documento_url: null,
        veiculo_id: null,
        matricula_snapshot: x.matricula,
        descricao: [x.semana, x.motorista, x.motivo].filter(Boolean).join(" · "),
        valor: String(x.valor),
      })),
    ]);
    if (e2) {
      console.error("fecharAcerto linhas error:", e2);
      return { success: false, error: "Acerto criado, mas falharam as linhas." };
    }
  }

  // As despesas que entraram neste acerto ficam QUITADAS: foram descontadas ao
  // parceiro, logo já foram recuperadas — deixá-las 'pendente' fazia a lista de
  // despesas pedir para sempre um dinheiro que já tinha entrado pelo acerto.
  // Só as que estão mesmo nas linhas deste acerto (imputadas ao proprietário,
  // deste mês); as da GoScooters ou do motorista têm outro ciclo e não se tocam.
  const despesasNoAcerto = p.linhas
    .filter((l) => l.tipo === "despesa" && l.despesa_id)
    .map((l) => l.despesa_id as string);
  if (despesasNoAcerto.length > 0) {
    const { error: eDesp } = await supabaseAdmin
      .from("despesa")
      .update({ estado_pagamento: "paga" })
      .in("id", despesasNoAcerto)
      .eq("estado_pagamento", "pendente"); // não mexe em parciais/isentas já decididas
    if (eDesp) {
      // Não desfaz o acerto por causa disto: o extrato está certo e a quitação
      // pode ser corrigida à mão na lista de despesas.
      console.error("fecharAcerto quitar despesas error:", eDesp);
    }
  }

  await notificar({
    tipo: "acerto_por_pagar",
    titulo: "Acerto fechado — por acertar com o parceiro",
    detalhe: `${p.proprietario_nome} · ${competencia} · líquido ${formatarPreco(p.liquido)}`,
    href: `/admin/acertos/${acerto.id}`,
    entidade: "acerto",
    entidade_id: acerto.id,
  });

  revalidatePath("/admin/acertos");
  revalidatePath("/admin/despesas");
  return { success: true, id: acerto.id };
}

export async function marcarAcertoPago(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { error } = await supabaseAdmin
    .from("acerto")
    .update({ estado: "pago" })
    .eq("id", id);
  if (error) return { success: false, error: "Erro ao marcar como pago." };

  revalidatePath("/admin/acertos");
  return { success: true };
}

/**
 * Acrescenta um ajuste manual ao acerto de um mês (bónus/correção/dedução).
 * Valor assinado: + soma ao líquido, − desconta. Persiste em acerto_ajuste, por
 * isso sobrevive a recalcular; entra no líquido e congela ao fechar. Recusa se o
 * mês já estiver fechado (aí o extrato está congelado).
 */
export async function adicionarAjusteAcerto(
  proprietarioId: string,
  competencia: string,
  descricao: string,
  valor: number,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!/^\d{4}-\d{2}$/.test(competencia)) return { success: false, error: "Mês inválido." };
  const desc = descricao.trim();
  if (!desc) return { success: false, error: "Indica uma descrição." };
  if (!Number.isFinite(valor) || Math.abs(valor) < 0.005) {
    return { success: false, error: "Indica um valor diferente de zero." };
  }

  const { data: ja } = await supabaseAdmin
    .from("acerto")
    .select("id")
    .eq("proprietario_id", proprietarioId)
    .eq("competencia_mes", `${competencia}-01`)
    .maybeSingle();
  if (ja) return { success: false, error: "Este mês já foi fechado — não dá para acrescentar ajustes." };

  const { error } = await supabaseAdmin.from("acerto_ajuste").insert({
    proprietario_id: proprietarioId,
    competencia_mes: `${competencia}-01`,
    descricao: desc,
    valor: String(Math.round(valor * 100) / 100),
    criado_por: auth.user.email ?? null,
  });
  if (error) {
    console.error("adicionarAjusteAcerto error:", error);
    return {
      success: false,
      error: "Erro ao gravar o ajuste (confirma que correste sql/fase10_acerto_ajuste.sql).",
    };
  }
  revalidatePath("/admin/acertos");
  return { success: true };
}

/** Remove um ajuste manual (só antes de fechar; depois de fechado está congelado). */
export async function removerAjusteAcerto(id: string): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  const { error } = await supabaseAdmin.from("acerto_ajuste").delete().eq("id", id);
  if (error) return { success: false, error: "Erro ao remover o ajuste." };
  revalidatePath("/admin/acertos");
  return { success: true };
}

/**
 * Link público do extrato do acerto, para enviar ao parceiro — mesmo padrão do
 * contrato e do comprovativo: página com token assinado, sem conta nem login.
 *
 * O portal continua a ser o sítio certo para quem tem acesso; isto serve o
 * parceiro que quer só ver, ou guardar o PDF, sem entrar em lado nenhum.
 */
export async function criarLinkAcerto(
  acertoId: string,
): Promise<{ success: boolean; link?: string; whatsapp?: string | null; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data: a } = await supabaseAdmin
    .from("acerto")
    .select("id, competencia_mes, liquido, proprietario_id")
    .eq("id", acertoId)
    .maybeSingle();
  if (!a) return { success: false, error: "Acerto não encontrado." };

  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host") ?? "goscooters.vercel.app"}`;
  const link = `${origin}/acerto/${assinarAcerto(a.id)}`;

  let whatsapp: string | null = null;
  if (a.proprietario_id) {
    const { data: dono } = await supabaseAdmin
      .from("proprietario")
      .select("nome, telefone_e164")
      .eq("id", a.proprietario_id)
      .maybeSingle();
    // e164 (e não `telefone`): é o número já normalizado, o mesmo que os outros
    // links de WhatsApp do projeto usam.
    const tel = (dono?.telefone_e164 ?? "").replace(/\D/g, "");
    if (tel) {
      const mes = mesPorExtenso(a.competencia_mes as string);
      const primeiro = (dono?.nome ?? "").split(" ")[0];
      const texto = `Olá ${primeiro}, aqui está o extrato do acerto de ${mes} (GoScooters): ${link}`;
      whatsapp = `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
    }
  }

  return { success: true, link, whatsapp };
}

const MESES_EXT = [
  "", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// "2026-08-01" → "agosto de 2026". NÃO exportada: num ficheiro "use server"
// só podem ser exportadas funções assíncronas.
function mesPorExtenso(competenciaMes: string): string {
  const [ano, mes] = competenciaMes.slice(0, 7).split("-");
  return `${MESES_EXT[Number(mes)] ?? mes} de ${ano}`;
}
