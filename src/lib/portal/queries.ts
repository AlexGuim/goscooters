import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { calcularHistoricoAtivo, type HistoricoAtivo } from "@/lib/ativoHistorico";
import type { Acerto, AcertoLinha } from "@/types/db";

/** Linha do acerto + o documento (fatura/portagem/coima/seguro) da despesa de origem. */
export type AcertoLinhaComDoc = AcertoLinha & { documento_url: string | null };

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
  return calcularHistoricoAtivo(motoId);
}
