import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Consulta partilhada: que comprovativo ACTIVO (não anulado) cobre cada
 * pagamento. Usada pela lista de pagamentos (para mostrar a referência) e pela
 * emissão (para não haver dois documentos do mesmo dinheiro).
 *
 * De propósito em DUAS queries, sem `!inner`: um embed do PostgREST depende da
 * cache de esquema (que fica estagnada logo a seguir a uma migração, PGRST200)
 * e devolve formas diferentes conforme a cardinalidade. Duas queries simples são
 * previsíveis.
 */

/** A tabela ainda não existe (migração fase11 por correr). */
export const CODIGOS_SEM_TABELA = ["42P01", "PGRST205", "PGRST200"];
export const semTabela = (e: { code?: string } | null | undefined) =>
  CODIGOS_SEM_TABELA.includes(e?.code ?? "");

export interface ComprovativoDeReferencia {
  id: string;
  numero: string;
}

export type MapaComprovativos = Map<string, ComprovativoDeReferencia>;

/**
 * Devolve `{ ok: true, mapa }` ou `{ ok: false, semTabela }`. O chamador decide:
 * a listagem tolera a falha (mostra a lista sem referências), mas a emissão e o
 * estorno têm de FALHAR FECHADO — emitir um segundo documento para o mesmo
 * dinheiro, ou apagar um pagamento deixando o comprovativo vivo, é pior do que
 * recusar a operação.
 */
export async function comprovativosAtivosDe(
  pagamentoIds: string[],
): Promise<{ ok: true; mapa: MapaComprovativos } | { ok: false; semTabela: boolean }> {
  const mapa: MapaComprovativos = new Map();
  const ids = [...new Set(pagamentoIds.filter(Boolean))];
  if (!ids.length) return { ok: true, mapa };

  const { data: itens, error: eItens } = await supabaseAdmin
    .from("comprovativo_pagamento_item")
    .select("pagamento_id, comprovativo_id")
    .in("pagamento_id", ids);
  if (eItens) return { ok: false, semTabela: semTabela(eItens) };
  if (!itens?.length) return { ok: true, mapa };

  const compIds = [...new Set(itens.map((i) => i.comprovativo_id).filter(Boolean) as string[])];
  const { data: cabs, error: eCabs } = await supabaseAdmin
    .from("comprovativo_pagamento")
    .select("id, numero, anulado_em")
    .in("id", compIds);
  if (eCabs) return { ok: false, semTabela: semTabela(eCabs) };

  const activo = new Map(
    (cabs ?? []).filter((c) => !c.anulado_em).map((c) => [c.id, { id: c.id, numero: c.numero }]),
  );
  for (const i of itens) {
    const c = activo.get(i.comprovativo_id as string);
    if (c) mapa.set(i.pagamento_id as string, c);
  }
  return { ok: true, mapa };
}
