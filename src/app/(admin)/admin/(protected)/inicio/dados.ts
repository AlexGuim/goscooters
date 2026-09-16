import "server-only";

import { cache } from "react";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resultadoDoAno } from "@/lib/financeiro";
import { lerPaginado } from "@/lib/leituraPaginada";
import { mesDeHojeEmLisboa, semanaDeHojeEmLisboa } from "@/lib/datas";
import {
  emAtraso,
  semanaDeRendas,
  type EmAtraso,
  type LinhaDaSemana,
  type LinhaEmAtraso,
  type SemanaDeRendas,
} from "@/lib/inicioCobranca";
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
 *
 * A outra maneira de mostrar um número errado com ar de certo é parar nas mil
 * linhas que o PostgREST devolve de cada vez, sem dizer nada. As leituras que
 * podem lá chegar vão página a página, pelo mesmo leitor do Resultado.
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

/**
 * As cobranças em atraso — o mesmo filtro da página Cobrança: `em_atraso` (que a
 * vista só dá a por liquidar e parciais já vencidas) e sem cauções, que se
 * cobram em mão na entrega.
 *
 * Lida uma vez por ecrã (`cache`): o cartão dos Números e a linha da Cobrança
 * mostram o mesmo conjunto e não podem discordar. E página a página, porque
 * anos de atrasos antigos passam das mil linhas e o PostgREST cortava-as sem
 * dizer nada — o valor aparecia a menos, calado.
 */
const cobrancasEmAtraso = cache(
  (): Promise<LinhaEmAtraso[]> =>
    lerPaginado("Início", "as cobranças em atraso", (de, ate) =>
      supabaseAdmin
        .from("vw_cobranca_estado")
        .select("em_falta")
        .eq("em_atraso", true)
        .neq("tipo", "caucao")
        .order("id")
        .range(de, ate),
    ),
);

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

  const [porResolver, porPreencher, atrasadas, porRecolher, ativos] = await Promise.all([
    supabaseAdmin.from("notificacao").select("id", { count: "exact", head: true }).neq("estado", "feita"),
    contarContratos(["pre_contrato", "rascunho"]),
    // O MESMO conjunto que a linha da Cobrança soma, lido uma só vez: eram duas
    // consultas ao mesmo filtro em dois instantes, e um pagamento a entrar entre
    // elas punha 7 num sítio e 6 no outro, no mesmo ecrã.
    cobrancasEmAtraso(),
    contarContratos(["pendente_fecho"]),
    contarContratos(["ativo"]),
  ]);

  return {
    por_resolver: contagem("as notificações por resolver", porResolver),
    por_preencher: contagem("os contratos por preencher", porPreencher),
    em_atraso: atrasadas.length,
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
  // `data ?? []` diria «Tudo tratado 🎉» no dia em que a leitura viesse vazia
  // por avaria — a mesma falha disfarçada de bom dia que o resto do ficheiro evita.
  return linhas("a caixa de próxima ação", { data, error }) as Notificacao[];
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

  const [atrasadas, daSemana] = await Promise.all([
    cobrancasEmAtraso(),
    lerPaginado<LinhaDaSemana>("Início", `as rendas de ${de} a ${ate}`, (dePagina, atePagina) =>
      supabaseAdmin
        .from("vw_cobranca_estado")
        .select("valor_devido, valor_pago, desconto, em_falta, estado_liquidacao")
        .eq("tipo", "renda")
        .gte("data_vencimento", de)
        .lte("data_vencimento", ate)
        .neq("estado_liquidacao", "anulada")
        .order("id")
        .range(dePagina, atePagina),
    ),
  ]);

  return {
    atraso: emAtraso(atrasadas),
    semana: semanaDeRendas(daSemana),
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
 * O número é o MESMO da tabela do Resultado — vem de `resultadoDoAno`, que o
 * calcula pelo fecho de gestão, com a mesma conta da tabela. O Início não
 * recalcula nada: só escolhe os meses e desenha. Quando a janela atravessa a
 * virada do ano, leem-se os dois anos.
 */
export async function lerResultado(quantos = 6): Promise<ResultadoDoInicio> {
  const mesAtual = mesDeHojeEmLisboa();
  const competencias = competenciasAte(mesAtual, quantos);
  const anos = [...new Set(competencias.map((c) => Number(c.slice(0, 4))))];

  // Só o Resultado de cada mês: é o único número que o gráfico mostra, e assim
  // não se paga a conta da receita em caixa em cada visita ao Início.
  // Lança quando a base falha — não devolve zeros a fingir.
  const lidos = await Promise.all(anos.map((ano) => resultadoDoAno(ano)));

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
