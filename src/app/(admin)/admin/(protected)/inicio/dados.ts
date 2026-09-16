import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { financeiroAno } from "@/lib/financeiro";
import { mesDeHojeEmLisboa, semanaDeHojeEmLisboa } from "@/lib/datas";
import { emAtraso, semanaDeRendas, type EmAtraso, type SemanaDeRendas } from "@/lib/inicioCobranca";
import { competenciasAte, type MesDoResultado } from "@/lib/inicioResultado";
import type { ContratoEstado, Notificacao } from "@/types/db";

/**
 * As leituras dos blocos do Início.
 *
 * Regra da casa: uma consulta que falha NÃO vira zero. O supabase-js não lança
 * — devolve `{ data: null, error }` — e com `count ?? 0` o Início mostrava «0 em
 * atraso» com toda a calma no dia em que a base estava em baixo. Aqui cada
 * consulta verifica o `error` e lança; quem apanha é o bloco, que mostra «Não
 * foi possível carregar» só na sua fatia do ecrã.
 */

interface ErroDaBase {
  message: string;
}

function seFalhou(oQue: string, error: ErroDaBase | null): void {
  if (error) throw new Error(`Início: não foi possível ler ${oQue}: ${error.message}`);
}

/** Linhas que não podem ser confundidas com "não há nada": ou vêm, ou dá erro. */
function linhas<T>(oQue: string, r: { data: T[] | null; error: ErroDaBase | null }): T[] {
  seFalhou(oQue, r.error);
  if (r.data === null) throw new Error(`Início: ${oQue} veio sem linhas.`);
  return r.data;
}

/** Uma contagem que não pode ser confundida com zero: ou vem, ou dá erro. */
function contagem(oQue: string, r: { count: number | null; error: ErroDaBase | null }): number {
  seFalhou(oQue, r.error);
  if (r.count === null) throw new Error(`Início: ${oQue} veio sem contagem.`);
  return r.count;
}

export interface NumerosDoInicio {
  por_resolver: number;
  por_preencher: number;
  em_atraso: number;
  por_recolher: number;
  ativos: number;
}

/**
 * Os cinco números do topo.
 *
 * «Por preencher» conta o MESMO que a lista para onde aponta: pré-contratos e
 * rascunhos, que é o filtro `preenchimento` de ContratosList. Antes dizia
 * «Pré-contratos» e contava só metade — clicava-se no 3 e apareciam 5.
 */
export async function lerNumeros(): Promise<NumerosDoInicio> {
  const contarContratos = (estados: ContratoEstado[]) =>
    supabaseAdmin.from("contrato_aluguer").select("id", { count: "exact", head: true }).in("estado", estados);

  const [porResolver, porPreencher, emAtraso, porRecolher, ativos] = await Promise.all([
    supabaseAdmin.from("notificacao").select("id", { count: "exact", head: true }).neq("estado", "feita"),
    contarContratos(["pre_contrato", "rascunho"]),
    // "Em atraso" = renda/extras vencidos; a caução (cobrada em mão) não conta,
    // para bater certo com a caixa de notificações e a lista de cobranças.
    supabaseAdmin
      .from("vw_cobranca_estado")
      .select("id", { count: "exact", head: true })
      .eq("em_atraso", true)
      .neq("tipo", "caucao"),
    contarContratos(["pendente_fecho"]),
    contarContratos(["ativo"]),
  ]);

  return {
    por_resolver: contagem("as notificações por resolver", porResolver),
    por_preencher: contagem("os contratos por preencher", porPreencher),
    em_atraso: contagem("as cobranças em atraso", emAtraso),
    por_recolher: contagem("os contratos por recolher", porRecolher),
    ativos: contagem("os contratos ativos", ativos),
  };
}

/** As notificações por resolver, as mais recentes primeiro. */
export async function lerNotificacoes(limite = 50): Promise<Notificacao[]> {
  const { data, error } = await supabaseAdmin
    .from("notificacao")
    .select("*")
    .neq("estado", "feita")
    .order("created_at", { ascending: false })
    .limit(limite);
  seFalhou("a caixa de próxima ação", error);
  return (data ?? []) as Notificacao[];
}

// ── Bloco Cobrança ──────────────────────────────────────────────────────────

export interface CobrancaDoInicio {
  atraso: EmAtraso;
  semana: SemanaDeRendas;
}

/**
 * As duas linhas da Cobrança: o que está em atraso e como vai a semana.
 *
 * O filtro do atraso é o MESMO da página Cobrança — `em_atraso` (que a vista só
 * dá a cobranças por liquidar ou parciais já vencidas) e sem cauções, que se
 * cobram em mão. A semana é a de calendário, domingo→sábado, em Lisboa, e só
 * conta rendas: cauções e extras não são a renda da semana.
 */
export async function lerCobranca(): Promise<CobrancaDoInicio> {
  const { de, ate } = semanaDeHojeEmLisboa();

  const [atrasoRes, semanaRes] = await Promise.all([
    supabaseAdmin
      .from("vw_cobranca_estado")
      .select("em_falta")
      .eq("em_atraso", true)
      .neq("tipo", "caucao"),
    supabaseAdmin
      .from("vw_cobranca_estado")
      .select("valor_devido, valor_pago, desconto, em_falta, estado_liquidacao")
      .eq("tipo", "renda")
      .gte("data_vencimento", de)
      .lte("data_vencimento", ate)
      .neq("estado_liquidacao", "anulada"),
  ]);

  return {
    atraso: emAtraso(linhas("as cobranças em atraso", atrasoRes)),
    semana: semanaDeRendas(linhas(`as rendas de ${de} a ${ate}`, semanaRes)),
  };
}

// ── Bloco Resultado ─────────────────────────────────────────────────────────

export interface ResultadoDoInicio {
  meses: MesDoResultado[];
  /** O mês em curso, "AAAA-MM" (hora de Lisboa). */
  mes_atual: string;
}

/**
 * O Resultado dos últimos `quantos` meses (por omissão 6: cinco fechados mais o
 * mês em curso).
 *
 * O número é o MESMO da tabela do Resultado — vem de `financeiroAno`, que o
 * calcula pelo fecho de gestão. O Início não recalcula nada: só escolhe os meses
 * e desenha. Quando a janela atravessa a virada do ano, leem-se os dois anos.
 */
export async function lerResultado(quantos = 6): Promise<ResultadoDoInicio> {
  const mesAtual = mesDeHojeEmLisboa();
  const competencias = competenciasAte(mesAtual, quantos);
  const anos = [...new Set(competencias.map((c) => Number(c.slice(0, 4))))];

  // financeiroAno lança quando a base falha — não devolve zeros a fingir.
  const lidos = await Promise.all(anos.map((ano) => financeiroAno(ano)));

  const porCompetencia = new Map<string, number>();
  for (const ano of lidos) {
    for (const m of ano.meses) {
      porCompetencia.set(`${ano.ano}-${String(m.mes).padStart(2, "0")}`, m.resultado);
    }
  }

  return {
    meses: competencias.map((competencia) => {
      const resultado = porCompetencia.get(competencia);
      if (resultado === undefined) throw new Error(`Início: o Resultado de ${competencia} não veio.`);
      return { competencia, resultado };
    }),
    mes_atual: mesAtual,
  };
}
