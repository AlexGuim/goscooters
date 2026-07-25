import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export interface CondutorNaData {
  contrato_id: string;
  contrato_numero: string;
  motorista_id: string;
  motorista_nome: string;
  proprietario_id: string | null;
  veiculo_id: string;
}

/**
 * Encontra o contrato do veículo que cobria uma data (ex.: a data de uma
 * infração) e devolve o condutor. Um contrato "cobre" a data se começou até lá e
 * ainda não tinha terminado (data_fim nula ou posterior). Inclui contratos já
 * concluídos — a coima chega semanas depois, com o contrato possivelmente fechado.
 * Devolve o mais recente que cobre a data, ou null se nenhum cobrir.
 */
export async function contratoDoVeiculoNaData(
  veiculoId: string,
  data: string,
): Promise<CondutorNaData | null> {
  if (!veiculoId || !data) return null;

  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id, numero, motorista_id, proprietario_id, veiculo_id, data_inicio")
    .eq("veiculo_id", veiculoId)
    .lte("data_inicio", data)
    .or(`data_fim.is.null,data_fim.gte.${data}`)
    .in("estado", ["ativo", "pendente_fecho", "suspenso", "concluido"])
    .order("data_inicio", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!c || !c.motorista_id) return null;

  const { data: m } = await supabaseAdmin
    .from("motorista")
    .select("nome")
    .eq("id", c.motorista_id)
    .maybeSingle();

  return {
    contrato_id: c.id,
    contrato_numero: c.numero,
    motorista_id: c.motorista_id,
    motorista_nome: m?.nome ?? "—",
    proprietario_id: c.proprietario_id ?? null,
    veiculo_id: c.veiculo_id ?? veiculoId,
  };
}
