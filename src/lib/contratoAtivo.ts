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
 * Um concluído sem data_fim (fechado no formulário, importado sem data) só cobre
 * até à última semana de renda que chegou a ser devida; sem renda nenhuma, não
 * cobre. Devolve o mais recente que cobre a data, ou null se nenhum cobrir (ou se
 * não foi possível ler) — melhor ficar por identificar do que dar a coima a quem
 * teve a mota noutra altura.
 */
export async function contratoDoVeiculoNaData(
  veiculoId: string,
  data: string,
): Promise<CondutorNaData | null> {
  const r = await contratoDoVeiculoNaDataOuErro(veiculoId, data);
  return r.ok ? r.contrato : null;
}

/** Como contratoDoVeiculoNaData, mas distingue "nenhum contrato cobria a data" de "não consegui ler". */
export async function contratoDoVeiculoNaDataOuErro(
  veiculoId: string,
  data: string,
): Promise<{ ok: true; contrato: CondutorNaData | null } | { ok: false }> {
  if (!veiculoId || !data) return { ok: true, contrato: null };

  const { data: candidatos, error } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id, numero, motorista_id, proprietario_id, veiculo_id, data_inicio, data_fim, estado")
    .eq("veiculo_id", veiculoId)
    .lte("data_inicio", data)
    .or(`data_fim.is.null,data_fim.gte.${data}`)
    .in("estado", ["ativo", "pendente_fecho", "suspenso", "concluido"])
    .order("data_inicio", { ascending: false })
    .limit(5);
  if (error) {
    console.error("contratoDoVeiculoNaData:", error.message);
    return { ok: false };
  }

  // Posto de lado um contrato mais recente, os mais antigos sem data_fim só contam
  // com renda devida até à data: sem isso, um contrato antigo e aberto nos dados
  // ficava com a coima de quando a mota estava parada.
  let saltouUm = false;
  for (const c of candidatos ?? []) {
    if (!c.motorista_id) {
      saltouUm = true;
      continue;
    }
    if (!c.data_fim && (c.estado === "concluido" || saltouUm)) {
      const cobre = await temRendaAte(c.id, data);
      if (cobre === null) return { ok: false };
      if (!cobre) {
        saltouUm = true;
        continue;
      }
    }
    const { data: m, error: erroM } = await supabaseAdmin
      .from("motorista")
      .select("nome")
      .eq("id", c.motorista_id)
      .maybeSingle();
    if (erroM) {
      console.error("contratoDoVeiculoNaData (motorista):", erroM.message);
      return { ok: false };
    }
    return {
      ok: true,
      contrato: {
        contrato_id: c.id,
        contrato_numero: c.numero,
        motorista_id: c.motorista_id,
        motorista_nome: m?.nome ?? "—",
        proprietario_id: c.proprietario_id ?? null,
        veiculo_id: c.veiculo_id ?? veiculoId,
      },
    };
  }
  return { ok: true, contrato: null };
}

/**
 * Um contrato sem data_fim cobre a data se ainda havia renda devida nela (a última
 * semana não anulada acaba nesse dia ou depois). Sem renda nenhuma não há prova
 * de até quando teve a mota: não cobre. Null se não consegui ler.
 */
async function temRendaAte(contratoId: string, data: string): Promise<boolean | null> {
  const { data: linhas, error } = await supabaseAdmin
    .from("cobranca")
    .select("periodo_fim")
    .eq("contrato_id", contratoId)
    .eq("tipo", "renda")
    .neq("estado_liquidacao", "anulada")
    .order("periodo_fim", { ascending: false })
    .limit(1);
  if (error) {
    console.error("contratoDoVeiculoNaData (rendas):", error.message);
    return null;
  }
  const ultima = linhas?.[0]?.periodo_fim;
  return Boolean(ultima && ultima >= data);
}
