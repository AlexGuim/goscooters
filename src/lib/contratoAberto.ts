import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ContratoEstado } from "@/types/db";

/** O contrato em curso de um motorista, tal como o wizard precisa de o ver. */
export type ContratoAberto = { id: string; numero: string; estado: ContratoEstado };

/** Pré-contrato e rascunho: o que está a meio do caminho. */
export const emPreenchimento = (e: ContratoEstado) => e === "pre_contrato" || e === "rascunho";

/**
 * O contrato que um motorista já tem em curso, se tiver.
 *
 * O mais recente em preenchimento (pré-contrato ou rascunho) — é o que o
 * wizard sabe terminar; só depois o mais recente dos ativos. É a MESMA regra
 * da lista de motoristas (`escolherContratoEmCurso`), para os dois ecrãs
 * apontarem para o mesmo contrato.
 *
 * Lança em caso de erro: "não sei" não pode ler-se como "não tem" — era assim
 * que nascia um rascunho por cima de um pré-contrato.
 */
export async function contratoAbertoDe(motoristaId: string): Promise<ContratoAberto | null> {
  const { data, error } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id, numero, estado")
    .eq("motorista_id", motoristaId)
    .in("estado", ["pre_contrato", "rascunho", "ativo", "pendente_fecho", "suspenso"])
    .order("created_at", { ascending: false });
  if (error) {
    console.error("contratoAbertoDe error:", error);
    throw new Error("Não consegui verificar os contratos do motorista.");
  }
  return escolherContratoEmCurso((data ?? []) as ContratoAberto[]);
}

/** Dada a lista (mais recente primeiro), o contrato que conta como "em curso". */
export function escolherContratoEmCurso<T extends { estado: ContratoEstado }>(lista: T[]): T | null {
  return lista.find((c) => emPreenchimento(c.estado)) ?? lista[0] ?? null;
}
