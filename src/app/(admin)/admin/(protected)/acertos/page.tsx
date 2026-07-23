import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import type { Acerto, AcertoLinha, Proprietario } from "@/types/db";
import AcertosList, { type AcertoComLinhas } from "./AcertosList";

async function getDados(): Promise<{
  acertos: AcertoComLinhas[];
  proprietarios: Pick<Proprietario, "id" | "nome" | "comissao_valor">[];
}> {
  const [acRes, linRes, donosRes] = await Promise.all([
    supabaseAdmin
      .from("acerto")
      .select("*")
      .order("competencia_mes", { ascending: false }),
    supabaseAdmin.from("acerto_linha").select("*"),
    supabaseAdmin
      .from("proprietario")
      .select("id, nome, comissao_valor")
      .eq("eh_goscooters", false)
      .eq("ativo", true)
      .order("nome"),
  ]);

  const nomeDono = new Map((donosRes.data ?? []).map((d) => [d.id, d.nome]));
  const linhasPor = new Map<string, AcertoLinha[]>();
  for (const l of linRes.data ?? []) {
    const arr = linhasPor.get(l.acerto_id) ?? [];
    arr.push(l);
    linhasPor.set(l.acerto_id, arr);
  }

  const acertos: AcertoComLinhas[] = (acRes.data ?? []).map((a: Acerto) => ({
    ...a,
    proprietario_nome: nomeDono.get(a.proprietario_id) ?? "—",
    linhas: linhasPor.get(a.id) ?? [],
  }));

  return { acertos, proprietarios: donosRes.data ?? [] };
}

export default async function AcertosAdminPage() {
  await requireAdmin();
  const { acertos, proprietarios } = await getDados();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Acertos</h1>
        <p className="mt-1 text-slate-600">
          Fecho mensal por parceiro: receita − comissão − despesas = a transferir.
        </p>
      </div>

      <AcertosList inicial={acertos} proprietarios={proprietarios} />
    </div>
  );
}
