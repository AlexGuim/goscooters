import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import CobrancasList, { type CobrancaPainel } from "./CobrancasList";

async function getDados(): Promise<{
  cobrancas: CobrancaPainel[];
  whatsappNumero: string;
}> {
  // Só as que precisam de atenção: por liquidar ou parciais.
  const [cobRes, motsRes, motosRes, donosRes] = await Promise.all([
    supabaseAdmin
      .from("vw_cobranca_estado")
      .select("*")
      .in("estado_liquidacao", ["por_liquidar", "parcial"])
      .order("data_vencimento", { ascending: true }),
    supabaseAdmin.from("motorista").select("id, nome, telefone, telefone_e164"),
    supabaseAdmin.from("moto").select("id, matricula, modelo"),
    supabaseAdmin.from("proprietario").select("*"),
  ]);

  const mot = new Map((motsRes.data ?? []).map((m) => [m.id, m]));
  const moto = new Map((motosRes.data ?? []).map((m) => [m.id, m]));
  const dono = new Map((donosRes.data ?? []).map((d) => [d.id, d]));

  const cobrancas: CobrancaPainel[] = (cobRes.data ?? []).map(
    (c: Record<string, unknown>) => {
      const m = mot.get(c.motorista_id as string);
      const v = moto.get(c.veiculo_id as string);
      const d = c.proprietario_id ? dono.get(c.proprietario_id as string) : undefined;
      return {
        id: c.id as string,
        numero: c.numero as string,
        contrato_id: c.contrato_id as string,
        motorista_id: c.motorista_id as string,
        motorista_nome: m?.nome ?? "—",
        motorista_telefone: m?.telefone ?? null,
        motorista_e164: m?.telefone_e164 ?? null,
        veiculo_matricula: v?.matricula ?? "—",
        proprietario_id: (c.proprietario_id as string) ?? null,
        proprietario_nome: d?.nome ?? "Sem proprietário",
        proprietario_recebe_direto: !!d?.recebe_pagamento_direto,
        periodo_inicio: c.periodo_inicio as string,
        periodo_fim: c.periodo_fim as string,
        data_vencimento: c.data_vencimento as string,
        valor_devido: String(c.valor_devido),
        valor_pago: String(c.valor_pago),
        em_falta: String(c.em_falta),
        // A caução é cobrada em mão na entrega — nunca "em atraso" (só por liquidar).
        em_atraso: Boolean(c.em_atraso) && c.tipo !== "caucao",
        estado_liquidacao: c.estado_liquidacao as CobrancaPainel["estado_liquidacao"],
        tipo: (c.tipo as CobrancaPainel["tipo"]) ?? "renda",
      };
    },
  );

  return {
    cobrancas,
    whatsappNumero: process.env.WHATSAPP_NUMERO?.replace(/\D/g, "") || "",
  };
}

export default async function CobrancasAdminPage() {
  await requireAdmin();
  const { cobrancas } = await getDados();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Cobrança</h1>
        <p className="mt-1 text-slate-600">
          Quem deve, quem está em atraso, e registo de pagamentos.
        </p>
      </div>

      <CobrancasList inicial={cobrancas} />
    </div>
  );
}
