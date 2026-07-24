"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import type { PagamentoMetodo, PagamentoRecebidoPor } from "@/types/db";

export interface AlocacaoInput {
  cobranca_id: string;
  valor_alocado: number;
}

export interface RegistarPagamentoInput {
  motorista_id: string;
  valor: number;
  data_recebimento: string;
  metodo?: PagamentoMetodo | null;
  referencia?: string | null;
  /** Quem recebeu: 'goscooters' (default) ou 'proprietario' (conta do parceiro). */
  recebido_por?: PagamentoRecebidoPor;
  alocacoes: AlocacaoInput[];
}

/**
 * Regista um pagamento e aloca-o às cobranças (semanas). Uma transferência pode
 * cobrir várias semanas — a alocação N:M é o que o resolve. Os gatilhos da BD
 * recalculam sozinhos o estado de cada cobrança abrangida.
 */
export async function registarPagamento(
  input: RegistarPagamentoInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!input.motorista_id) return { success: false, error: "Motorista em falta." };
  const total = Number(input.valor);
  if (!Number.isFinite(total) || total <= 0) {
    return { success: false, error: "Indica um valor válido." };
  }

  const alocacoes = (input.alocacoes ?? []).filter((a) => a.valor_alocado > 0);
  const soma = alocacoes.reduce((s, a) => s + a.valor_alocado, 0);
  // Pequena folga para arredondamentos.
  if (soma > total + 0.001) {
    return { success: false, error: "A soma das alocações excede o valor recebido." };
  }

  const { data: pag, error } = await supabaseAdmin
    .from("pagamento")
    .insert({
      motorista_id: input.motorista_id,
      valor: String(total),
      data_recebimento: input.data_recebimento,
      metodo: input.metodo ?? null,
      referencia: input.referencia?.trim() || null,
      // Só enviar recebido_por quando NÃO é o default, para o insert funcionar
      // mesmo antes da migração (coluna inexistente). Omisso → default da BD.
      ...(input.recebido_por && input.recebido_por !== "goscooters"
        ? { recebido_por: input.recebido_por }
        : {}),
    })
    .select("id")
    .single();

  if (error) {
    console.error("registarPagamento error:", error);
    return { success: false, error: "Erro ao gravar o pagamento." };
  }

  if (alocacoes.length > 0) {
    const { error: e2 } = await supabaseAdmin.from("pagamento_cobranca").insert(
      alocacoes.map((a) => ({
        pagamento_id: pag.id,
        cobranca_id: a.cobranca_id,
        valor_alocado: String(a.valor_alocado),
      })),
    );
    if (e2) {
      console.error("registarPagamento alocacao error:", e2);
      return { success: false, error: "Pagamento gravado, mas falhou a alocação às semanas." };
    }
  }

  revalidatePath("/admin/cobrancas");
  return { success: true, id: pag.id };
}
