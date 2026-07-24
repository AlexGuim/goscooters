"use server";

import { requireAdminForAction } from "@/lib/dal";
import { calcularHistoricoAtivo, type HistoricoAtivo } from "@/lib/ativoHistorico";

/** Histórico do ativo (P&L por moto) para o admin. */
export async function historicoAtivo(
  motoId: string,
): Promise<{ success: boolean; dados?: HistoricoAtivo; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const dados = await calcularHistoricoAtivo(motoId);
  if (!dados) return { success: false, error: "Moto não encontrada." };
  return { success: true, dados };
}
