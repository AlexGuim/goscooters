import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import type { ContratoAluguer, Moto, Motorista, Proprietario } from "@/types/db";
import ContratosList, { type ContratoComNomes } from "./ContratosList";

async function getDados(): Promise<{
  contratos: ContratoComNomes[];
  motoristas: Pick<Motorista, "id" | "nome" | "telefone">[];
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
  proprietarios: Pick<Proprietario, "id" | "nome">[];
}> {
  const [contratosRes, motsRes, motosRes, donosRes, cobRes] = await Promise.all([
    supabaseAdmin
      .from("contrato_aluguer")
      .select("*")
      .order("estado")
      .order("data_inicio", { ascending: false }),
    supabaseAdmin.from("motorista").select("id, nome, telefone").order("nome"),
    supabaseAdmin.from("moto").select("id, matricula, modelo, proprietario_id").order("matricula"),
    supabaseAdmin.from("proprietario").select("id, nome").order("nome"),
    // Contagem de cobranças por contrato, para mostrar se a faturação já começou.
    supabaseAdmin.from("cobranca").select("contrato_id"),
  ]);

  const nomeMot = new Map((motsRes.data ?? []).map((m) => [m.id, m.nome]));
  const infoMoto = new Map((motosRes.data ?? []).map((m) => [m.id, m]));
  const nomeDono = new Map((donosRes.data ?? []).map((d) => [d.id, d.nome]));
  const numCob = new Map<string, number>();
  for (const c of cobRes.data ?? []) {
    if (c.contrato_id) numCob.set(c.contrato_id, (numCob.get(c.contrato_id) ?? 0) + 1);
  }

  const contratos: ContratoComNomes[] = (contratosRes.data ?? []).map(
    (c: ContratoAluguer) => ({
      ...c,
      motorista_nome: nomeMot.get(c.motorista_id) ?? "—",
      veiculo_matricula: c.veiculo_id ? infoMoto.get(c.veiculo_id)?.matricula ?? "—" : "—",
      veiculo_modelo: c.veiculo_id ? infoMoto.get(c.veiculo_id)?.modelo ?? "" : "",
      proprietario_nome: c.proprietario_id ? nomeDono.get(c.proprietario_id) ?? null : null,
      num_cobrancas: numCob.get(c.id) ?? 0,
    }),
  );

  return {
    contratos,
    motoristas: motsRes.data ?? [],
    motos: motosRes.data ?? [],
    proprietarios: donosRes.data ?? [],
  };
}

export default async function ContratosAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  await requireAdmin();
  const [{ f }, { contratos, motoristas, motos, proprietarios }] = await Promise.all([
    searchParams,
    getDados(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Contratos</h1>
        <p className="mt-1 text-slate-600">
          Aluguer ativo por motorista e veículo, e a faturação de cada um.
        </p>
      </div>

      <ContratosList
        inicial={contratos}
        motoristas={motoristas}
        motos={motos}
        proprietarios={proprietarios}
        filtroInicial={f === "preenchimento" ? "preenchimento" : undefined}
      />
    </div>
  );
}
