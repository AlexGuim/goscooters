import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import type { Despesa, Moto, Proprietario } from "@/types/db";
import DespesasList, { type DespesaComNomes } from "./DespesasList";
import ImportarFatura from "./ImportarFatura";
import IntakeDocumento from "./IntakeDocumento";
import { motoristasParaIntake } from "@/lib/motoristasParaIntake";

async function getDados(): Promise<{
  despesas: DespesaComNomes[];
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
  proprietarios: Pick<Proprietario, "id" | "nome">[];
}> {
  const [despRes, motosRes, donosRes] = await Promise.all([
    supabaseAdmin
      .from("despesa")
      .select("*")
      .order("data_despesa", { ascending: false }),
    supabaseAdmin.from("moto").select("id, matricula, modelo, proprietario_id").order("matricula"),
    supabaseAdmin.from("proprietario").select("id, nome").order("nome"),
  ]);

  const matricula = new Map((motosRes.data ?? []).map((m) => [m.id, m.matricula]));
  const nomeDono = new Map((donosRes.data ?? []).map((d) => [d.id, d.nome]));

  const despesas: DespesaComNomes[] = (despRes.data ?? []).map((d: Despesa) => ({
    ...d,
    veiculo_matricula: d.veiculo_id ? matricula.get(d.veiculo_id) ?? "—" : null,
    proprietario_nome: d.proprietario_id ? nomeDono.get(d.proprietario_id) ?? null : null,
  }));

  return {
    despesas,
    motos: motosRes.data ?? [],
    proprietarios: donosRes.data ?? [],
  };
}

export default async function DespesasAdminPage() {
  await requireAdmin();
  // Os motoristas também: um documento de identidade ou um comprovativo que
  // entre por aqui segue para a ficha/cobrança em vez de bater num aviso.
  const [{ despesas, motos, proprietarios }, motoristas] = await Promise.all([
    getDados(),
    motoristasParaIntake(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Despesas</h1>
        <p className="mt-1 text-slate-600">
          Custos por veículo: manutenção, portagens, coimas, seguro, GPS.
        </p>
      </div>

      <IntakeDocumento motos={motos} motoristas={motoristas} />

      <details className="rounded-3xl bg-white p-6 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          Importar fatura sem IA (OCR/texto) — alternativa
        </summary>
        <div className="mt-4">
          <ImportarFatura motos={motos} />
        </div>
      </details>

      <DespesasList inicial={despesas} motos={motos} proprietarios={proprietarios} />
    </div>
  );
}
