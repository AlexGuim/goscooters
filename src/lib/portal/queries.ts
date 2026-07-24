import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Acerto, AcertoLinha } from "@/types/db";

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
): Promise<{ acerto: Acerto; linhas: AcertoLinha[] } | null> {
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

  return { acerto, linhas: linhas ?? [] };
}
