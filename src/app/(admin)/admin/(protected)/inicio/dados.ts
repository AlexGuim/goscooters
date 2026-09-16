import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
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
